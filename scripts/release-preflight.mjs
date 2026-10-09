/**
 * Read-only release preflight.
 * Never reads or prints the value of NEON_DSN and never starts Docker or writes to public.
 * Default returns 0 and explains blockers. --strict fails closed if deploy is not ready.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function command(executable, args, env = process.env) {
  try {
    const result = spawnSync(executable, args, {
      cwd: ROOT, encoding: 'utf8', timeout: 10000,
      env, maxBuffer: 3 * 1024 * 1024, windowsHide: true,
    })
    return { ok: result.status === 0, output: String(result.stdout ?? '') }
  } catch {
    return { ok: false, output: '' }
  }
}

export function listRecentBackups(base, now = Date.now()) {
  if (!fs.existsSync(base)) return false
  const folders = [base]
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    if (ent.isDirectory()) folders.push(path.join(base, ent.name))
  }
  return folders.some(dir => {
    const files = fs.readdirSync(dir)
    const dbs = files.filter(name => /^db-.*\.json$/.test(name))
    const assets = files.filter(name => /^uploads-.*\.tar$/.test(name))
    const fresh = name => {
      try {
        const info = fs.statSync(path.join(dir, name))
        return info.isFile() && info.size > 100 && now - info.mtimeMs < 48 * 3600_000 && info.mtimeMs <= now + 60_000
      } catch { return false }
    }
    // A database dump and attachments must belong to the same backup batch.
    // Two unrelated fresh files must never satisfy the deploy safety gate.
    return dbs.some(db => {
      const suffix = db.slice(3, -'.json'.length)
      return fresh(db) && assets.includes(`uploads-${suffix}.tar`) && fresh(`uploads-${suffix}.tar`)
    })
  })
}

export function evaluateReleaseReadiness(facts) {
  const checks = [
    { id: 'source', label: '前后端、迁移和容器源文件齐全', passed: !!facts.sourceComplete, gate: 'source' },
    { id: 'bundle', label: '正式页面 dist/index.html 已构建', passed: !!facts.bundleReady, gate: 'source' },
    { id: 'git-diff', label: 'Git diff 无冲突和空白错误', passed: !!facts.gitDiffClean && !facts.gitConflicts, gate: 'source' },
    { id: 'secret-ignore', label: '本地数据库密钥文件被 Git 忽略', passed: !!facts.secretIgnored && !facts.trackedSensitiveFiles, gate: 'source' },
    { id: 'compose', label: 'Docker Compose 静态配置合法', passed: !!facts.composeValid, gate: 'source' },
    { id: 'git-clean', label: '交付代码已受控提交，不含未跟踪工作区改动', passed: !!facts.gitClean, gate: 'deploy' },
    { id: 'docker-engine', label: '目标部署主机 Docker Engine 可用', passed: !!facts.dockerEngine, gate: 'deploy' },
    { id: 'database-secret', label: '正式连接串通过进程环境注入', passed: !!facts.productionDsnConfigured, gate: 'deploy' },
    { id: 'persistent-uploads', label: '正式 UPLOAD_DIR 是独立绝对目录', passed: !!facts.persistentUploadsConfigured, gate: 'deploy' },
    { id: 'fresh-backup', label: '48 小时内数据库与附件备份均存在', passed: !!facts.freshBackup, gate: 'deploy' },
  ]
  const sourceReady = checks.filter(c => c.gate === 'source').every(c => c.passed)
  const deploymentReady = sourceReady && checks.every(c => c.passed)
  return {
    schemaVersion: 1,
    sourceReady,
    deploymentReady,
    summary: deploymentReady ? '具备执行正式部署前置条件；仍须人工验收 HTTPS、镜像运行和业务路径' : '尚不具备直接上线的全部前置条件',
    checks,
    blockers: checks.filter(c => !c.passed).map(c => c.id),
  }
}

export function gatherReleaseFacts(now = Date.now()) {
  const required = [
    'server/neon-gateway.mjs', 'server/client-ip.mjs', 'server/static-site.mjs',
    'scripts/start-prod.mjs', 'scripts/neon-schema.sql', 'scripts/neon-migrations.sql',
    'Dockerfile', 'compose.prod.yml', '.dockerignore', 'package.json', 'pnpm-lock.yaml',
    'src/App.tsx', 'docs/18-完整前后端发布候选与运维交接.md',
  ]
  const gitStatus = command('git', ['status', '--porcelain=v1', '-uall'])
  const changed = gitStatus.output.split(/\r?\n/).filter(Boolean)
  const diff = command('git', ['diff', '--check'])
  const ignored = command('git', ['check-ignore', '-q', 'dev-secrets.local'])
  const tracked = command('git', ['ls-files', '-z'])
  const sensitive = tracked.output.split('\0').filter(name =>
    /(^|\/)(?:dev-secrets\.local|\.env(?:\.[^/]*)?|credentials[^/]*|[^/]+\.(?:pem|key))$/i.test(name) &&
    !/(^|\/)\.env\.example$/i.test(name),
  )
  const compose = command('docker', ['compose', '-f', 'compose.prod.yml', 'config', '--quiet'], {
    ...process.env, NEON_DSN: 'postgresql://not-used.invalid/ci',
  })
  const engine = command('docker', ['info', '--format', '{{.ServerVersion}}'])
  const uploads = String(process.env.UPLOAD_DIR ?? '')
  const assets = path.resolve(ROOT, 'dist')
  const uploadPath = uploads ? path.resolve(uploads) : ''
  const outsideDist = !!uploadPath && uploadPath !== assets && !uploadPath.startsWith(assets + path.sep)
  return {
    sourceComplete: required.every(name => fs.existsSync(path.join(ROOT, name))),
    bundleReady: fs.existsSync(path.join(ROOT, 'dist', 'index.html')),
    gitDiffClean: diff.ok,
    gitConflicts: changed.some(line => ['UU', 'AA', 'DD'].includes(line.slice(0, 2))),
    gitClean: gitStatus.ok && changed.length === 0,
    secretIgnored: ignored.ok,
    trackedSensitiveFiles: !tracked.ok || sensitive.length > 0,
    composeValid: compose.ok,
    dockerEngine: engine.ok,
    productionDsnConfigured: /^postgres(?:ql)?:\/\//i.test(String(process.env.NEON_DSN ?? '')),
    persistentUploadsConfigured: path.isAbsolute(uploads) && outsideDist,
    freshBackup: listRecentBackups(path.join(ROOT, 'backups'), now),
  }
}

const direct = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direct) {
  const report = evaluateReleaseReadiness(gatherReleaseFacts())
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('随缘网｜生产发布只读预检')
    for (const item of report.checks) {
      console.log((item.passed ? 'PASS ' : 'BLOCK') + ' ' + item.label)
    }
    console.log('源码检查：' + (report.sourceReady ? '已就绪' : '未完全就绪'))
    console.log('正式部署检查：' + (report.deploymentReady ? '已就绪' : '阻断'))
    console.log(report.summary)
    console.log('仅做本地静态检查；不代表 HTTPS、容器运行或真实客户旅程已经在目标服务器通过。')
  }
  if (process.argv.includes('--strict') && !report.deploymentReady) process.exitCode = 2
}
