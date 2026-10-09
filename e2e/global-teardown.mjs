// 发布冒烟收尾：停掉测试网关实例并销毁隔离 schema，不留任何残留数据。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { STATE_FILE } from './global-setup.mjs'

export default async function globalTeardown() {
  let state = null
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {}

  try {
    const pid = Number(state?.pid ?? 0)
    if (pid) process.kill(pid, 'SIGTERM')
  } catch {}
  fs.rmSync(STATE_FILE, { force: true })
  const uploadDir = String(state?.uploadDir ?? '')
  if (uploadDir && uploadDir.startsWith(path.join(os.tmpdir(), 'suiyuan-e2e-uploads-'))) {
    fs.rmSync(uploadDir, { recursive: true, force: true })
  }

  const schema = String(state?.schema ?? '')
  const dsn = process.env.NEON_DSN
  if (!dsn || !/^[a-z0-9_]{1,63}$/.test(schema)) return
  const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query(`drop schema if exists ${schema} cascade`)
  await client.end()
  console.log('发布冒烟环境已销毁')
}
