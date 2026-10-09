// 本机管理员密码恢复工具。
//
// 用法：
//   pnpm admin:reset -- admin@example.com
//
// 安全约束：
// - 只从 dev-secrets.local / NEON_DSN 读取数据库连接，不把连接串写入源码或日志。
// - 只允许重置 profiles.role='admin' 的账号。
// - 临时密码随机生成，只在当前本机终端显示一次。
// - 数据库存储 bcrypt 哈希；密码变化会使旧登录令牌的密码指纹失效。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

for (const name of ['dev-secrets.local', '.env.local', '.env.development.local']) {
  const vars = parseEnvFile(path.join(ROOT, name))
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] == null) process.env[k] = v
  }
}

const email = String(process.argv[2] ?? '').trim().toLowerCase()
const copyToClipboard = process.argv.includes('--clipboard')
if (!email || !email.includes('@')) {
  console.error('用法：pnpm admin:reset -- <管理员邮箱>')
  process.exit(1)
}

const dsn = process.env.NEON_DSN
if (!dsn || !/^postgres(?:ql)?:\/\//i.test(dsn)) {
  console.error('缺少本机 NEON_DSN，请先运行 pnpm dev:full 完成数据库配置。')
  process.exit(1)
}

const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
let temp = ''
for (let i = 0; i < 12; i++) temp += alpha[crypto.randomInt(alpha.length)]

const pool = new pg.Pool({
  connectionString: dsn,
  ssl: { rejectUnauthorized: false },
})

const client = await pool.connect()
try {
  await client.query('begin')
  const found = await client.query(
    `select u.id, u.email, p.nickname
       from public.users u
       join public.profiles p on p.sid = u.id
      where lower(u.email) = lower($1) and p.role = 'admin'
      limit 1
      for update of u`,
    [email],
  )
  const account = found.rows[0]
  if (!account) throw new Error('未找到该管理员账号，已取消操作')

  const hash = bcrypt.hashSync(temp, 10)
  await client.query(
    'update public.users set password_hash = $1, updated = now() where id = $2',
    [hash, account.id],
  )
  await client.query('commit')

  if (copyToClipboard && process.platform === 'win32') {
    const clip = spawnSync('clip.exe', [], { input: temp, encoding: 'utf8', windowsHide: true })
    if (clip.status !== 0) throw new Error('密码已重置，但复制到系统剪贴板失败')
    console.log('管理员密码已重置成功，临时密码已复制到系统剪贴板。')
    console.log(`账号：${account.email}`)
    console.log(`昵称：${account.nickname ?? ''}`)
    console.log('请在登录页密码框按 Ctrl+V，并在登录后立即修改密码。')
  } else {
    console.log('')
    console.log('管理员密码已重置成功')
    console.log(`账号：${account.email}`)
    console.log(`昵称：${account.nickname ?? ''}`)
    console.log(`临时密码：${temp}`)
    console.log('')
    console.log('请登录后立即修改密码。临时密码不会保存为明文。')
  }
} catch (e) {
  try { await client.query('rollback') } catch { /* 已回滚 */ }
  console.error(`重置失败：${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
