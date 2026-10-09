/**
 * Staging-only migration wrapper. Never executes against public.
 * Requires independently supplied STAGING_NEON_DSN and staging_* schema.
 * Normal mode is a NO-WRITE dry run. Applying requires --apply --confirm=<schema>.
 */
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { evaluateStagingConfig } from './staging-preflight.mjs'

const config = evaluateStagingConfig(process.env)
if (!config.ready) {
  console.error('[staging] 环境参数未通过只读校验：' + config.blockers.join(', '))
  process.exit(2)
}
const schema = process.env.STAGING_SCHEMA
const apply = process.argv.includes('--apply')
const confirm = process.argv.includes(`--confirm=${schema}`)
if (apply && !confirm) {
  console.error('[staging] 写入模式须明确传入 --confirm=' + schema + '，并先完成独立数据库备份审查。')
  process.exit(2)
}
if (!apply) console.log('[staging] 仅执行数据库迁移 dry-run；无数据写入')
else console.log('[staging] 已确认仅更新隔离 staging schema：' + schema)
const env = {
  ...process.env,
  NEON_DSN: process.env.STAGING_NEON_DSN,
  NEON_SCHEMA: schema,
  MIGRATE_FORCE: '',
}
const result = spawnSync(process.execPath, ['scripts/neon-migrate.mjs', ...(apply ? [] : ['--dry-run'])], {
  env, stdio: 'inherit', windowsHide: true, timeout: 90_000,
})
if (result.error) {
  console.error('[staging] 执行程序异常：' + result.error.code)
  process.exit(1)
}
process.exit(result.status ?? 1)
