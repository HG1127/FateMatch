/**
 * Safe, read-only staging readiness gate.
 * Never prints credentials, connects to Neon, starts containers, or modifies database schema.
 * Actual deployment requires separate staging DB credentials and an explicit staging_* schema.
 */
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function evaluateStagingConfig(env) {
  const dsn = String(env.STAGING_NEON_DSN ?? '')
  const productionDsn = String(env.NEON_DSN ?? '')
  const schema = String(env.STAGING_SCHEMA ?? '')
  const port = String(env.STAGING_PORT || '8081')
  const checks = []
  checks.push({ key: 'dedicated-staging-dsn', ok: /^postgres(?:ql)?:\/\//i.test(dsn), label: '单独提供 STAGING_NEON_DSN，不复用生产连接参数名称' })
  checks.push({ key: 'different-from-production', ok: !!dsn && (!productionDsn || dsn !== productionDsn), label: '如生产 NEON_DSN 在环境中可见，不允许两套连接串完全相同' })
  checks.push({ key: 'staging-schema', ok: /^staging_[a-z0-9_]{3,48}$/.test(schema) && schema !== 'staging_public', label: 'STAGING_SCHEMA 必须为 staging_*，不能使用 public' })
  checks.push({ key: 'loopback-port', ok: /^\d{4,5}$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535, label: 'STAGING_PORT 必须是有效的本地非特权端口' })
  return { ready: checks.every(item => item.ok), checks, blockers: checks.filter(item => !item.ok).map(item => item.key) }
}

const direct = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direct) {
  const templateMode = process.argv.includes('--template')
  const example = { STAGING_NEON_DSN: 'postgresql://template.invalid/staging_db', STAGING_SCHEMA: 'staging_ci_preview', STAGING_PORT: '8081' }
  const report = evaluateStagingConfig(templateMode ? example : process.env)
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ mode: templateMode ? 'template_only' : 'deployment_config', ...report }, null, 2) + '\n')
  } else {
    console.log('随缘网｜预发布部署配置只读检查' + (templateMode ? '（仅模板，不代表主机具备真实部署条件）' : ''))
    for (const check of report.checks) console.log((check.ok ? 'PASS ' : 'BLOCK ') + check.label)
    console.log(report.ready ? '配置字段通过；仍需独立数据库、迁移、容器、HTTPS、真实浏览器验证' : '预发布环境缺少必要参数，请勿启动')
  }
  if (!report.ready) process.exitCode = 2
}
