// Production standalone runner: one origin for compiled React UI and Neon API.
// Requires credentials in the *process environment*; never reads dev .local files.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isWithinDirectory } from '../server/static-site.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staticDir = path.resolve(process.env.STATIC_DIR || path.join(ROOT, 'dist'))
const uploadDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : ''
const port = Number(process.env.PORT ?? 8080)
const schema = String(process.env.NEON_SCHEMA ?? 'public')

function fail(message) {
  console.error('[start:prod] ' + message)
  process.exit(1)
}

if (!/^postgres(?:ql)?:\/\//i.test(process.env.NEON_DSN ?? '')) {
  fail('NEON_DSN 未配置；正式服务只从受管环境变量获取连接串')
}
if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
  fail('缺少构建产物，请先运行 pnpm build')
}
if (!process.env.UPLOAD_DIR || !path.isAbsolute(process.env.UPLOAD_DIR)) {
  fail('UPLOAD_DIR 必须指向独立的绝对持久化目录，避免重新部署丢失会员图片')
}
if (isWithinDirectory(staticDir, uploadDir)) {
  fail('UPLOAD_DIR 不能位于 dist 下，会员照片只能通过签名 API 访问')
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail('PORT 必须为 1–65535 之间的整数')
}
if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) {
  fail('NEON_SCHEMA 配置不合法')
}

fs.mkdirSync(uploadDir, { recursive: true })
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SERVE_STATIC: '1',
  STATIC_DIR: staticDir,
  UPLOAD_DIR: uploadDir,
  PORT: String(port),
  // 安全默认值：本地直接启动仅绑定回环接口；Compose 容器显式设置 HOST=0.0.0.0。
  HOST: process.env.HOST || '127.0.0.1',
}
const gateway = spawn(process.execPath, ['server/neon-gateway.mjs'], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
  windowsHide: false,
})
console.log('[start:prod] 正在启动同源前端/API，计划监听端口 ' + port)
console.log('[start:prod] 探针：/api/health（存活）、/api/ready（数据库就绪）')
console.log('[start:prod] TLS/域名应在反向代理终止；API 和网站使用同一源')

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    try { gateway.kill(signal) } catch {}
  })
}
gateway.on('error', e => fail('网关启动失败：' + e.message))
gateway.on('exit', (code, signal) => {
  if (!stopping && code !== 0) console.error('[start:prod] 网关异常退出：' + (code ?? signal))
  process.exit(code ?? (stopping ? 0 : 1))
})
