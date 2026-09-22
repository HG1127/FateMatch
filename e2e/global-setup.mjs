// 发布冒烟前置：在 Neon 里建一次性隔离 schema 并灌表结构，
// 拉起一个指向该 schema 的网关实例（7200），测试结束后整体销毁。
// 连接串只经环境变量传入，不落盘。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'

export const SCHEMA = 'e2e_smoke'
export const GW_PORT = 7200
export const PID_FILE = path.join(os.tmpdir(), 'neon-e2e-gw.pid')

async function waitHealth(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url + '/api/health')
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('测试网关未能在时限内就绪')
}

export default async function globalSetup() {
  const dsn = process.env.NEON_DSN
  if (!dsn) throw new Error('运行发布冒烟需要 NEON_DSN 环境变量')

  const ddl = fs.readFileSync('scripts/neon-schema.sql', 'utf8')
  const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query(`drop schema if exists ${SCHEMA} cascade`)
  await client.query(`create schema ${SCHEMA}`)
  // 连接池为事务模式：search_path 只用事务级设置，避免会话设置泄漏到其他连接
  await client.query('begin')
  await client.query(`select set_config('search_path', '${SCHEMA}', true)`)
  await client.query(ddl)
  await client.query('commit')
  await client.end()

  const gw = spawn('node', ['server/neon-gateway.mjs'], {
    env: { ...process.env, PORT: String(GW_PORT), NEON_SCHEMA: SCHEMA },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: false,
  })
  fs.writeFileSync(PID_FILE, String(gw.pid))
  gw.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`测试网关异常退出 code=${code}`)
  })
  await waitHealth(`http://127.0.0.1:${GW_PORT}`)
  console.log(`发布冒烟环境就绪：schema=${SCHEMA} gateway=:${GW_PORT}`)
}
