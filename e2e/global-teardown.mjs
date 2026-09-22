// 发布冒烟收尾：停掉测试网关实例并销毁隔离 schema，不留任何残留数据。
import fs from 'node:fs'
import pg from 'pg'
import { SCHEMA, PID_FILE } from './global-setup.mjs'

export default async function globalTeardown() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8'))
    if (pid) process.kill(pid, 'SIGTERM')
    fs.rmSync(PID_FILE, { force: true })
  } catch {}

  const dsn = process.env.NEON_DSN
  if (!dsn) return
  const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query(`drop schema if exists ${SCHEMA} cascade`)
  await client.end()
  console.log('发布冒烟环境已销毁')
}
