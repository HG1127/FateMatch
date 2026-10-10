// Local all-in-one China test launcher. Runs both Node API and password-protected
// mobile UI on loopback, bypassing the Mainland->Render HTTPS connectivity problem.
// Credentials can ONLY come from china-staging.local (Git-ignored) and are checked
// against the explicitly isolated Neon project role/database before starting.
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertIsolatedLocalDev } from './staging-local-target.mjs'
import { createChinaPreviewServer, loadOrCreatePreviewSecrets } from './china-preview-server.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = path.join(ROOT, 'china-staging.local')
const DB_PORT = 8622
const PREVIEW_PORT = 8611
const LOOPBACK = '127.0.0.1'
const SCHEMA = 'staging_render_preview'

export function readChinaStagingConfig(filename = CONFIG_PATH) {
  if (!fs.existsSync(filename)) throw new Error(
    '缺少 china-staging.local。请在自己电脑上，从 Neon 测试项目复制专用 Staging 连接串；不要复用 dev-secrets.local。'
  )
  const values = {}
  for (const raw of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const at = line.indexOf('=')
    if (at <= 0) throw new Error('china-staging.local 存在不合法的配置行')
    const key = line.slice(0, at).trim()
    if (!['NEON_DSN','NEON_SCHEMA','STAGING_MODE'].includes(key) || Object.hasOwn(values, key)) {
      throw new Error('china-staging.local 含不受支持或重复的配置名称')
    }
    let value = line.slice(at + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  if (values.STAGING_MODE !== '1' || values.NEON_SCHEMA !== SCHEMA) {
    throw new Error('必须使用 STAGING_MODE=1 和 staging_render_preview；已拒绝其他数据库 schema')
  }
  assertIsolatedLocalDev(values)
  return values
}
async function unusedPort(port) {
  const srv = net.createServer()
  await new Promise((ok, fail) => {
    srv.once('error', fail)
    srv.listen(port, LOOPBACK, ok)
  })
  await new Promise(ok => srv.close(ok))
}
async function waitBackendReady(child, port, timeout = 75000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('独立 Staging 网关启动失败，请检查本地网络能否连接 Neon；已阻止公开不完整的网站')
    }
    try {
      const res = await fetch('http://' + LOOPBACK + ':' + port + '/api/ready', {
        signal: AbortSignal.timeout(3500),
      })
      if (res.status === 200) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1800))
  }
  throw new Error('75 秒内未能连接独立 Neon Staging；已停止启动，请核对网络和测试数据库连接串')
}
function safeStop(child) {
  if (child && child.exitCode === null) {
    try { child.kill('SIGTERM') } catch {}
  }
}
export async function runChinaLocalPreview() {
  if (!fs.existsSync(path.join(ROOT,'dist','index.html'))) {
    throw new Error('缺少移动端构建产物。请先执行 pnpm build')
  }
  // This validation happens before any port is opened or child process starts.
  const config = readChinaStagingConfig()
  await unusedPort(DB_PORT)
  await unusedPort(PREVIEW_PORT)
  const secret = loadOrCreatePreviewSecrets()
  const env = {
    ...process.env,
    ...config,
    NODE_ENV: 'production',
    STAGING_MODE: '1',
    SUIYUAN_EPHEMERAL_PREVIEW: '1',
    SERVE_STATIC: '0',
    HOST: LOOPBACK,
    PORT: String(DB_PORT),
    UPLOAD_DIR: path.join(ROOT, 'uploads', 'china-staging'),
    // No admin promotion by environment settings in preview mode.
    SY_ADMIN_EMAILS: '',
    ADMIN_EMAILS: '',
  }
  let child, preview
  let stopping = false
  async function cleanup() {
    if (stopping) return
    stopping = true
    preview?.close()
    safeStop(child)
  }
  try {
    child = spawn(process.execPath, ['server/neon-gateway.mjs'], {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    child.stderr.on('data', buffer => {
      // Avoid logging postgres credentials and environment; only safe fixed status.
      const line = String(buffer)
      if (/ECONN|ETIMEDOUT|certificate|connect timeout/i.test(line)) {
        console.error('[china-local] Neon Staging 连接暂不可用（无凭据输出）')
      }
    })
    console.log('[china-local] 正在检查独立 Neon Staging 数据库就绪状态；不会输出连接串')
    await waitBackendReady(child, DB_PORT)
    preview = createChinaPreviewServer({
      secret,
      upstream: 'http://' + LOOPBACK + ':' + DB_PORT,
      staticDir: path.join(ROOT, 'dist'),
    })
    await new Promise((ok, fail) => {
      preview.once('error', fail)
      preview.listen(PREVIEW_PORT, LOOPBACK, ok)
    })
    console.log('[china-local] 安全移动站已就绪：http://127.0.0.1:' + PREVIEW_PORT)
    console.log('[china-local] 本地独立 API 已就绪，严格使用 suiyuan_staging / ' + SCHEMA)
    console.log('[china-local] 仅允许使用 HTTPS 隧道公开 8611，严禁直接公开 API 端口 8622')
    console.log('[china-local] 访问口令请查看本机 Git 忽略的 china-preview.local，勿发送给他人')
    child.on('exit', async () => {
      if (!stopping) {
        console.error('[china-local] Staging 后端已停止，预览将一起关闭，避免功能半可用')
        await cleanup()
      }
    })
    for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => void cleanup())
    return { preview, child, cleanup }
  } catch (err) {
    await cleanup()
    throw err
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runChinaLocalPreview().catch(error => {
    console.error('[china-local] 启动已阻止：' + (error instanceof Error ? error.message : '未知错误'))
    process.exitCode = 2
  })
}
