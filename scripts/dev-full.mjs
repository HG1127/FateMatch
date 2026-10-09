// 本地一键全栈开发启动器：自动加载本机 Neon 连接、拉起数据网关，再启动 Vite。
//
// 连接串读取优先级：
//   1. 当前进程环境变量 NEON_DSN
//   2. dev-secrets.local（已被 *.local 的 .gitignore 规则排除）
//   3. .env.local / .env.development.local（如用户自行维护）
//
// 用法：pnpm dev:full
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const GATEWAY_PORT = Number(process.env.PORT ?? 7000)
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
const HEALTH_URL = `${GATEWAY_URL}/api/health`

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

function loadLocalEnv() {
  for (const name of ['dev-secrets.local', '.env.local', '.env.development.local']) {
    const vars = parseEnvFile(path.join(ROOT, name))
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] == null) process.env[k] = v
    }
  }
}

function readClipboardText() {
  if (process.platform !== 'win32') return ''
  try {
    const out = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 64 * 1024,
      },
    )
    if (out.status !== 0) return ''
    return String(out.stdout ?? '').trim()
  } catch {
    return ''
  }
}

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
      resolve('')
      return
    }

    process.stdout.write(label)
    let value = ''
    process.stdin.setEncoding('utf8')
    process.stdin.setRawMode(true)
    process.stdin.resume()

    const cleanup = () => {
      process.stdin.off('data', onData)
      try { process.stdin.setRawMode(false) } catch { /* 已恢复或不是 TTY */ }
      process.stdin.pause()
    }

    const onData = chunk => {
      for (const ch of String(chunk)) {
        // Windows 经典控制台在 raw mode 下不会替 Node 处理 Ctrl+V，
        // 而是传入一个 \x16 控制字符。这里主动读取系统剪贴板，
        // 只写入内存缓冲区，不回显秘密内容。
        if (ch === '\u0016' && process.platform === 'win32') {
          const pasted = readClipboardText()
          if (pasted) {
            value += pasted
            process.stdout.write(' [已粘贴]')
          } else {
            process.stdout.write(' [剪贴板为空或读取失败]')
          }
          continue
        }
        if (ch === '\u0003') {
          cleanup()
          process.stdout.write('\n')
          reject(new Error('已取消首次数据库配置'))
          return
        }
        if (ch === '\r' || ch === '\n') {
          cleanup()
          process.stdout.write('\n')
          resolve(value.trim())
          return
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += ch
      }
    }

    process.stdin.on('data', onData)
  })
}

async function ensureLocalDsn() {
  if (process.env.NEON_DSN && /^postgres(?:ql)?:\/\//i.test(process.env.NEON_DSN)) return

  if (process.stdin.isTTY && process.stdout.isTTY) {
    console.log('\n[dev:full] 首次运行需要保存一次 Neon 连接串。')
    console.log('[dev:full] 输入内容不会回显，也不会进入 Git。')
    const dsn = await promptHidden('请粘贴 NEON_DSN 后按 Enter：')
    if (!/^postgres(?:ql)?:\/\//i.test(dsn)) {
      throw new Error('连接串格式不正确，应以 postgresql:// 或 postgres:// 开头')
    }
    fs.writeFileSync(path.join(ROOT, 'dev-secrets.local'), `NEON_DSN=${dsn}\n`, { encoding: 'utf8', mode: 0o600 })
    process.env.NEON_DSN = dsn
    console.log('[dev:full] 已保存到 dev-secrets.local；以后启动无需再次输入。')
    return
  }

  throw new Error(
    '缺少本机 NEON_DSN。请在本机终端首次运行 pnpm dev:full 完成隐藏输入配置，' +
    '或复制 local-config.example 为 dev-secrets.local 后填写一次。',
  )
}

async function healthOk() {
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch {
    return false
  }
}

async function waitForHealth(child, timeoutMs = 45_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (child && child.exitCode !== null) {
      throw new Error(`Neon 网关提前退出，exitCode=${child.exitCode}`)
    }
    if (await healthOk()) return
    await new Promise(r => setTimeout(r, 750))
  }
  throw new Error(`Neon 网关未在 ${Math.round(timeoutMs / 1000)} 秒内就绪：${HEALTH_URL}`)
}

function canListen(port) {
  return new Promise(resolve => {
    const s = net.createServer()
    s.unref()
    s.on('error', () => resolve(false))
    // 与 Vite 的 host=0.0.0.0 保持一致，避免 Windows 上 127.0.0.1 探测误判。
    s.listen(port, '0.0.0.0', () => s.close(() => resolve(true)))
  })
}

async function chooseVitePort() {
  const preferred = Number(process.env.VITE_PORT ?? 8000)
  for (let port = preferred; port <= preferred + 10; port++) {
    if (await canListen(port)) return port
  }
  throw new Error(`端口 ${preferred}-${preferred + 10} 均被占用`)
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    // 退出清理失败不覆盖用户原始错误。
  }
}

loadLocalEnv()
try {
  await ensureLocalDsn()
} catch (e) {
  console.error(`\n[dev:full] ${e instanceof Error ? e.message : String(e)}`)
  console.error('[dev:full] 注意：不要把连接串发到聊天、提交到 Git 或写进前端代码。\n')
  process.exit(1)
}

let gateway = null
let vite = null
let stopping = false
let gatewayOwned = false

async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  stopChild(vite)
  if (gatewayOwned) stopChild(gateway)
  setTimeout(() => process.exit(code), 250)
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

try {
  if (await healthOk()) {
    console.log(`[dev:full] 复用已运行的数据网关：${GATEWAY_URL}`)
  } else {
    console.log('[dev:full] 正在启动 Neon 数据网关…')
    gatewayOwned = true
    // 本地开发后端也启用 watch：修改 gateway 后自动重启，避免前端热更新而后端仍运行旧契约。
    gateway = spawn(process.execPath, ['--watch', 'server/neon-gateway.mjs'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(GATEWAY_PORT) },
      stdio: 'inherit',
      windowsHide: false,
    })
    await waitForHealth(gateway)
    console.log(`[dev:full] 数据网关已就绪：${HEALTH_URL}`)
  }

  const vitePort = await chooseVitePort()
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  // 不传 --strictPort：即使端口在探测后被其他进程抢占，Vite 仍会自动顺延。
  const args = [viteBin, '--host', '0.0.0.0', '--port', String(vitePort)]
  if (process.env.NO_OPEN !== '1') args.push('--open')

  console.log(`[dev:full] 正在启动前端，首选端口 ${vitePort}；如被占用将自动顺延…`)
  vite = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      LOCAL_FULLSTACK: '1',
      LOCAL_GATEWAY_URL: GATEWAY_URL,
    },
    stdio: 'inherit',
    windowsHide: false,
  })

  vite.on('exit', code => {
    if (!stopping) void shutdown(code ?? 0)
  })

  if (gatewayOwned) {
    gateway.on('exit', code => {
      if (!stopping) {
        console.error(`[dev:full] 数据网关意外退出（${code ?? 'unknown'}），同时停止前端。`)
        void shutdown(code ?? 1)
      }
    })
  }
} catch (e) {
  console.error(`[dev:full] 启动失败：${e instanceof Error ? e.message : String(e)}`)
  await shutdown(1)
}
