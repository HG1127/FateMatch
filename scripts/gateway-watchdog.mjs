// 数据网关看门狗：看护 neon-gateway 进程，崩溃自动拉起。
//
// 安全约定：连接串不落盘。启动时从在跑的网关进程内存（/proc environ）接管 DSN，
// 之后只存在于本进程内存中，重启子进程时经环境变量传递。容器整体重启后 DSN 丢失，
// 需按 docs/12 的恢复流程重新注入（NEON_DSN=… 启动本脚本）。
//
// 用法：
//   接管现有网关并看护：  node scripts/gateway-watchdog.mjs
//   冷启动（容器重启后）：NEON_DSN='postgresql://…' node scripts/gateway-watchdog.mjs
// 可选环境变量：
//   WD_PORT   看护的网关端口（默认 7000）
//   WD_CMD    子进程命令（默认 "node server/neon-gateway.mjs"，测试可指向哑进程）
//   WD_SKIP_ADOPT=1  跳过「扫描并接管现有网关」，直接用本进程 NEON_DSN 冷启动子进程
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.WD_PORT ?? process.env.PORT ?? 7000)
const CMD = process.env.WD_CMD ?? 'node server/neon-gateway.mjs'
const SKIP_ADOPT = process.env.WD_SKIP_ADOPT === '1'
const ROOT = process.cwd()
const LOG_DIR = path.join(ROOT, 'logs')
const WD_LOG = path.join(LOG_DIR, 'watchdog.log')
const GW_LOG = path.join(LOG_DIR, 'neon-gateway.log')

const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`
const POLL_MS = 15_000 // 健康轮询间隔
const FAIL_KILL = 4 // 连续失败 N 次判定假死，主动杀掉重拉
const STABLE_MS = 10 * 60 * 1000 // 子进程稳定运行超过该时长后清零退避

fs.mkdirSync(LOG_DIR, { recursive: true })
const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`
  console.log(line)
  try { fs.appendFileSync(WD_LOG, line + '\n') } catch { /* 日志失败不影响看护 */ }
}

// ---------- /proc 扫描 ----------

function procEntries() {
  const out = []
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    let cmd
    let env = ''
    try {
      cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
      env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8')
    } catch { continue }
    out.push({ pid: Number(pid), cmd, env })
  }
  return out
}

/** 是否已有别的看门狗在跑（防双看护互杀子进程） */
function otherWatchdogRunning() {
  return procEntries().some(
    (p) => p.pid !== process.pid && p.cmd.some((a) => a.endsWith('gateway-watchdog.mjs')),
  )
}

/** 找到生产网关进程（排除测试实例：带 NEON_SCHEMA 的隔离环境） */
function findProdGateway() {
  for (const p of procEntries()) {
    if (p.cmd.length < 2) continue
    if (!p.cmd[0].endsWith('node')) continue
    if (!p.cmd.some((a) => a.endsWith('neon-gateway.mjs'))) continue
    if (p.env.split('\0').some((l) => l.startsWith('NEON_SCHEMA='))) continue
    const dsnLine = p.env.split('\0').find((l) => l.startsWith('NEON_DSN='))
    return { pid: p.pid, dsn: dsnLine ? dsnLine.slice('NEON_DSN='.length) : null }
  }
  return null
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

// ---------- 子进程看护 ----------

let dsn = process.env.NEON_DSN ?? ''
let child = null
let childStartedAt = 0
let respawnFails = 0
let healthFails = 0
let stopping = false

function spawnChild() {
  const [bin, ...args] = CMD.split(' ')
  const env = { ...process.env, NEON_DSN: dsn, PORT: String(PORT) }
  delete env.WD_SKIP_ADOPT
  delete env.WD_CMD
  const out = fs.openSync(GW_LOG, 'a')
  child = spawn(bin, args, { cwd: ROOT, env, stdio: ['ignore', out, out], detached: false })
  childStartedAt = Date.now()
  healthFails = 0
  log(`spawn: pid=${child.pid} port=${PORT} (第 ${respawnFails + 1} 次拉起)`)
  child.on('exit', (code, signal) => {
    fs.closeSync(out)
    if (stopping) return
    respawnFails += 1
    if (Date.now() - childStartedAt > STABLE_MS) respawnFails = 1 // 稳定运行过则重置退避
    const delay = Math.min(60_000, 1000 * 2 ** Math.max(0, respawnFails - 1))
    log(`exit: code=${code} signal=${signal}，${delay}ms 后重拉`)
    setTimeout(() => { if (!stopping) spawnChild() }, delay)
  })
}

async function pollHealth() {
  if (stopping || !child || child.exitCode !== null) return
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) })
    if (r.ok) {
      healthFails = 0
      return
    }
  } catch { /* 计入失败 */ }
  healthFails += 1
  if (healthFails >= FAIL_KILL) {
    log(`health: 连续 ${healthFails} 次失败，判定假死，杀掉重拉 pid=${child.pid}`)
    healthFails = 0
    child.kill('SIGKILL') // exit 事件会触发重拉
  }
}

// ---------- 每日自动备份（v1.9）：04:30 定时 + 启动补跑当日，产出落 backups/（已 gitignore） ----------

const BACKUP_HOUR = 4
const BACKUP_MIN = 30

function runScript(script, label) {
  log(`${label}：开始`)
  const out = fs.openSync(WD_LOG, 'a')
  let closed = false
  const closeOut = () => {
    if (closed) return
    closed = true
    try { fs.closeSync(out) } catch { /* 已关闭 */ }
  }
  // 连接串只经环境变量传给子进程，不落盘
  const b = spawn('node', [script], {
    cwd: ROOT,
    env: { ...process.env, NEON_DSN: dsn },
    stdio: ['ignore', out, out],
  })
  b.on('exit', (code) => {
    closeOut()
    if (!stopping) log(code === 0 ? `${label}：完成` : `${label}：失败 code=${code}`)
  })
  b.on('error', (e) => {
    closeOut()
    log(`${label}：失败 ${e.message}`)
  })
}

function runBackup(why) {
  runScript('scripts/neon-backup.mjs', `备份（${why}）`)
}

function msUntilNextBackup() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(BACKUP_HOUR, BACKUP_MIN, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

function scheduleBackup() {
  if (stopping) return
  setTimeout(() => {
    runBackup('每日定时')
    scheduleBackup()
  }, msUntilNextBackup())
}

function todayBackupDone() {
  const today = new Date().toISOString().slice(0, 10)
  try {
    return fs.existsSync(path.join(ROOT, 'backups', `db-${today}.json`))
  } catch {
    return false
  }
}

// ---------- 每周恢复演练（v1.10）：周日 04:35（错开每日备份），验证「备份真的能恢复」 ----------

const DRILL_DAY = 0 // 周日

function msUntilNextDrill() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(BACKUP_HOUR, BACKUP_MIN + 5, 0, 0)
  const delta = (DRILL_DAY - next.getDay() + 7) % 7
  next.setDate(next.getDate() + delta)
  if (next <= now) next.setDate(next.getDate() + 7)
  return next.getTime() - now.getTime()
}

function scheduleDrill() {
  if (stopping) return
  setTimeout(() => {
    runScript('scripts/neon-backup-drill.mjs', '恢复演练（每周）')
    scheduleDrill()
  }, msUntilNextDrill())
}

// ---------- 启动流程 ----------

async function main() {
  if (otherWatchdogRunning()) {
    log('已有看门狗在运行，本进程退出（防双看护）')
    process.exit(1)
  }

  if (!SKIP_ADOPT) {
    const gw = findProdGateway()
    if (gw) {
      if (!gw.dsn && !dsn) {
        log(`接管失败：网关 pid=${gw.pid} 内存中未找到连接串，退出`)
        process.exit(1)
      }
      if (gw.dsn) dsn = gw.dsn
      log(`接管现有网关 pid=${gw.pid}：优雅停止后由看门狗重新拉起`)
      process.kill(gw.pid, 'SIGTERM')
      for (let i = 0; i < 40 && pidAlive(gw.pid); i++) await new Promise((r) => setTimeout(r, 250))
      if (pidAlive(gw.pid)) {
        log(`pid=${gw.pid} 未按时退出，强制结束`)
        process.kill(gw.pid, 'SIGKILL')
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }

  if (!dsn) {
    log('缺少连接串：既没有可接管的网关，也没有 NEON_DSN 环境变量，退出')
    process.exit(1)
  }

  const shutdown = () => {
    if (stopping) return
    stopping = true
    log('收到停止信号，结束子进程后退出')
    if (child && child.exitCode === null) child.kill('SIGTERM')
    setTimeout(() => process.exit(0), 5000)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  spawnChild()
  setInterval(() => { void pollHealth() }, POLL_MS)

  // 每日自动备份 + 启动补跑（当日时点已过且无当日备份时，30 秒后补一次）
  scheduleBackup()
  const now = new Date()
  const pastDue = now.getHours() > BACKUP_HOUR || (now.getHours() === BACKUP_HOUR && now.getMinutes() >= BACKUP_MIN)
  if (pastDue && !todayBackupDone()) setTimeout(() => runBackup('启动补跑'), 30_000)
  // 每周恢复演练（周日 04:35）
  scheduleDrill()

  log(`看门狗就绪：健康检查 ${HEALTH_URL} 每 ${POLL_MS / 1000}s 轮询；每日 ${BACKUP_HOUR}:${String(BACKUP_MIN).padStart(2, '0')} 自动备份（保留 7 份，启动补跑当日）；每周日恢复演练`)
}

main().catch((e) => {
  log(`启动失败: ${e.message}`)
  process.exit(1)
})
