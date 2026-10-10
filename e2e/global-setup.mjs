// 发布冒烟前置：在 Neon 里建一次性隔离 schema 并灌表结构，
// 拉起一个指向该 schema 的网关实例（7200），测试结束后整体销毁。
// 连接串只经环境变量传入，不落盘。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { assertIsolatedLocalDev } from '../scripts/staging-local-target.mjs'

export const SCHEMA_PREFIX = 'e2e_smoke'
export const GW_PORT = 7200
export const STATE_FILE = path.join(os.tmpdir(), 'neon-e2e-state.json')
export const ADMIN_EMAIL = 'admin@smoke.test'
export const ADMIN_PASS = 'Admin#2026x'
const ADMIN_ID = 'e2eadmin0000001'

async function waitHealth(url, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url + '/api/health')
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('测试网关未能在时限内就绪')
}

async function dropTestSchema(dsn, schema) {
  const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(`drop schema if exists ${schema} cascade`)
  } finally {
    await client.end()
  }
}

export default async function globalSetup() {
  const dsn = process.env.NEON_DSN
  if (!dsn) throw new Error('运行发布冒烟需要 NEON_DSN 环境变量')
  // Defend against directly invoking Playwright and bypassing e2e-run.mjs.
  assertIsolatedLocalDev({ NEON_DSN: dsn, STAGING_MODE: '1', NEON_SCHEMA: 'staging_e2e_guard' })
  const schema = `${SCHEMA_PREFIX}_${process.pid}_${Date.now().toString(36)}`.toLowerCase()
  if (!/^[a-z0-9_]{1,63}$/.test(schema)) throw new Error('E2E schema 名称无效')
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suiyuan-e2e-uploads-'))
  // 预置一个真实存在的 legacy 文件，用于验证关闭 unsigned fallback 后仍不可 HTTP 读取。
  fs.writeFileSync(path.join(uploadDir, 'e2elegacy-0123456789abcdef01234567.png'), Buffer.from('89504e470d0a1a0a', 'hex'))

  const ddl = fs.readFileSync('scripts/neon-schema.sql', 'utf8')
  let client = null
  let gw = null
  let schemaCreated = false
  try {
    client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
    await client.connect()
    await client.query(`drop schema if exists ${schema} cascade`)
    await client.query(`create schema ${schema}`)
    schemaCreated = true
    // schema 一旦存在就立即登记；即使后续 DDL/播种/网关启动失败，teardown 或 catch 都知道该清什么。
    fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: 0, schema, uploadDir }), 'utf8')
    // 连接池为事务模式：search_path 只用事务级设置，避免会话设置泄漏到其他连接
    await client.query('begin')
    await client.query(`select set_config('search_path', '${schema}', true)`)
    await client.query(ddl)
    await client.query('commit')
    // 种一个测试掌柜：管理员身份只能由数据侧预置，接口不开放自我提权
    await client.query(
      `insert into ${schema}.users (id, email, password_hash, name, avatar, email_visibility, verified, created, updated)
       values ($1, $2, $3, '冒烟掌柜', '', false, true, now(), now())`,
      [ADMIN_ID, ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASS, 10)],
    )
    await client.query(
      `insert into ${schema}.profiles (id, sid, nickname, role, created, updated)
       values ($1, $1, '冒烟掌柜', 'admin', now(), now())`,
      [ADMIN_ID],
    )
    await client.end()
    client = null

    gw = spawn('node', ['server/neon-gateway.mjs'], {
      // Same-origin production bundle + API is exercised alongside Vite dev preview.
      // E2E validates production TLS certificate verification, not only development SSL.
      env: { ...process.env, NODE_ENV: 'production', PORT: String(GW_PORT), HOST: '127.0.0.1', NEON_SCHEMA: schema, UPLOAD_DIR: uploadDir, SERVE_STATIC: '1', STATIC_DIR: 'dist' },
      stdio: ['ignore', 'ignore', 'inherit'],
      detached: false,
    })
    fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: gw.pid, schema, uploadDir }), 'utf8')
    gw.on('exit', (code) => {
      if (code !== null && code !== 0) console.error(`测试网关异常退出 code=${code}`)
    })
    await waitHealth(`http://127.0.0.1:${GW_PORT}`)
    console.log(`发布冒烟环境就绪：schema=${schema} gateway=:${GW_PORT}`)
  } catch (error) {
    if (gw?.pid) {
      try { process.kill(gw.pid, 'SIGTERM') } catch {}
    }
    if (client) {
      try { await client.query('rollback') } catch {}
      try { await client.end() } catch {}
      client = null
    }
    if (schemaCreated) {
      try { await dropTestSchema(dsn, schema) } catch {}
    }
    fs.rmSync(uploadDir, { recursive: true, force: true })
    fs.rmSync(STATE_FILE, { force: true })
    throw error
  }
}
