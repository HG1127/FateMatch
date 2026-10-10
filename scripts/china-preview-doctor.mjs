/**
 * Safe, read-only local diagnosis for the mobile cpolar preview.
 * Never logs accessPassword, sessionKey, Neon DSN, or cpolar auth token.
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { readChinaStagingConfig } from './china-preview-local.mjs'
import { newPreviewToken } from './china-preview-server.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = 'http://127.0.0.1'
const loc = p => base + ':' + p
const details = []
// Distinguish a closed port from an active database-backed API that is warming up.
function listening(port) {
  return new Promise(resolve => {
    const conn = net.createConnection({ host: '127.0.0.1', port })
    let settled = false
    const done = value => {
      if (settled) return
      settled = true
      conn.destroy()
      resolve(value)
    }
    conn.once('connect', () => done(true))
    conn.once('error', () => done(false))
    conn.setTimeout(1200, () => done(false))
  })
}
async function probe(port, route, cookie, timeoutMs = 6000) {
  try {
    const r = await fetch(loc(port) + route, {
      redirect: 'manual',
      headers: cookie ? { Cookie: cookie } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
    return r.status
  } catch {
    return 0
  }
}
const configPresent = fs.existsSync(path.join(root, 'china-staging.local'))
let configValid = false
try {
  if (configPresent) {
    readChinaStagingConfig()
    configValid = true
  }
} catch {
  // Never print a DSN, even as part of the validation error.
}
let previewCookie = ''
try {
  const raw = fs.readFileSync(path.join(root, 'china-preview.local'), 'utf8')
  const secret = JSON.parse(raw)
  if (secret.sessionKey && secret.accessPassword) {
    previewCookie = '__Host-fatematch-preview=' + newPreviewToken(secret)
  }
} catch {}
const [apiListening, front, tunnelConsole] = await Promise.all([
  listening(8622),
  probe(8611, '/_preview/health'),
  probe(9200, '/'),
])
// First Neon request after idle can take several seconds. Avoid a false "port closed" verdict.
const [api, authApi] = await Promise.all([
  apiListening ? probe(8622, '/api/ready', '', 25000) : Promise.resolve(0),
  previewCookie ? probe(8611, '/api/ready', previewCookie, 25000) : Promise.resolve(0),
])
details.push(['测试数据库配置', configValid ? '有效' : configPresent ? '格式错误' : '缺失'])
details.push(['8611 受口令保护入口', front === 200 ? '正在运行' : '未启动'])
details.push(['8622 本地 Node+Neon', api === 200 ? '就绪' : apiListening ? (api ? '监听中但返回 HTTP ' + api : '监听中，Neon 连接超时，请检查网络') : '未启动'])
details.push(['8611 → 同源业务 API', authApi === 200 ? '就绪' : authApi ? '未就绪（HTTP ' + authApi + '）' : '未就绪或超时'])
details.push(['cpolar 本地控制台', tunnelConsole ? '正在运行' : '未发现'])
for (const [name, result] of details) console.log(name + '：' + result)
const done = configValid && front === 200 && api === 200 && authApi === 200
if (!done) {
  console.log('\n修复指引：')
  if (!configValid) console.log('1. 只在本机修正 china-staging.local，确保其使用专用 suiyuan_staging 数据库。')
  if (front === 200 && !apiListening) console.log('2. 8611 已启动但本地 8622 未启动：极可能运行了旧版 Render 代理。请先在原终端按 Ctrl+C，再执行 pnpm china:preview。')
  else if (apiListening && api !== 200) console.log('2. 本地 API 进程仍在监听；可能是 Neon 冷启动或查询超时。先检查电脑到 Neon Staging 的连接，不要改用生产库。')
  else if (api !== 200) console.log('2. 运行 pnpm china:preview 并等待 “本地独立 API 已就绪”；不要公开 8622。')
  else if (front !== 200) console.log('2. 运行 pnpm china:preview 并确认 8611 端口未被其他程序占用。')
  else if (authApi !== 200) console.log('2. 8611 未连接到可用的本地 API；停止旧服务，重新执行 pnpm china:preview。')
  if (!tunnelConsole) console.log('3. 如果需手机公网访问，请检查 cpolar 服务和在线隧道列表（仅公开 8611）。')
  process.exitCode = 2
} else {
  console.log('\n本地完整测试站已准备就绪。请从 cpolar HTTPS 网址进入；不要上传真实个人资料。')
}
