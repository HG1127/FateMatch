// 发布冒烟一键启动器：优先使用进程环境变量；缺失时只从本机忽略文件读取 NEON_DSN。
// 密钥仅存在于当前进程环境，不打印、不写入新文件，也不注入浏览器端。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readEnvValue(file, key) {
  if (!fs.existsSync(file)) return ''
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i <= 0 || line.slice(0, i).trim() !== key) continue
    let value = line.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    return value
  }
  return ''
}

if (!process.env.NEON_DSN) {
  for (const name of ['dev-secrets.local', '.env.local', '.env.development.local']) {
    const value = readEnvValue(path.join(ROOT, name), 'NEON_DSN')
    if (value) {
      process.env.NEON_DSN = value
      break
    }
  }
}

if (!/^postgres(?:ql)?:\/\//i.test(process.env.NEON_DSN ?? '')) {
  console.error('[e2e] 缺少 NEON_DSN。请先配置 dev-secrets.local，或在当前终端设置 NEON_DSN。')
  process.exit(1)
}

const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js')
if (!fs.existsSync(cli)) {
  console.error('[e2e] 未找到 Playwright CLI，请先安装项目依赖。')
  process.exit(1)
}

const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
  windowsHide: false,
})

const forward = signal => {
  if (child.exitCode == null) {
    try { child.kill(signal) } catch {}
  }
}
process.on('SIGINT', () => forward('SIGINT'))
process.on('SIGTERM', () => forward('SIGTERM'))
child.on('exit', code => process.exit(code ?? 1))
