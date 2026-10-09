// 对已有 Neon/Postgres 环境执行附加式、幂等 schema 升级。
// - 连接串只从 NEON_DSN 读取，不打印、不落盘。
// - 先执行完整基线 DDL：补齐缺失的新表/索引；再执行显式 migrations：为已有表补新列。
// - 整体在单事务中执行；任何一步失败全部回滚。
// - public 生产 schema 需要 MIGRATE_FORCE=yes，避免误操作。
//
// 用法：
//   node scripts/neon-migrate.mjs --dry-run
//   MIGRATE_FORCE=yes NEON_DSN='postgresql://…' pnpm db:migrate
//   NEON_SCHEMA=e2e_tmp NEON_DSN='postgresql://…' pnpm db:migrate
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE_FILE = path.join(ROOT, 'scripts', 'neon-schema.sql')
const MIGRATION_FILE = path.join(ROOT, 'scripts', 'neon-migrations.sql')
const schema = (process.env.NEON_SCHEMA || 'public').trim()
const dryRun = process.argv.includes('--dry-run')

if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) {
  throw new Error('NEON_SCHEMA 非法：仅允许字母、数字、下划线，且不能以数字开头')
}

const baseSql = fs.readFileSync(BASE_FILE, 'utf8')
const migrationSql = fs.readFileSync(MIGRATION_FILE, 'utf8')

if (dryRun) {
  console.log(`schema=${schema}`)
  console.log(`base=${path.relative(ROOT, BASE_FILE)}`)
  console.log(`migrations=${path.relative(ROOT, MIGRATION_FILE)}`)
  console.log('mode=dry-run (未连接数据库、未执行任何 SQL)')
  process.exit(0)
}

const dsn = process.env.NEON_DSN
if (!dsn) throw new Error('缺少 NEON_DSN；连接串只允许通过环境变量传入')
if (schema === 'public' && process.env.MIGRATE_FORCE !== 'yes') {
  throw new Error('生产 public schema 迁移需要显式设置 MIGRATE_FORCE=yes')
}

const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  await client.query('begin')
  await client.query(`create schema if not exists "${schema}"`)
  await client.query('select set_config(\'search_path\', $1, true)', [schema])

  // 完整基线负责创建缺失表/索引；显式 migration 负责补已有表的新列。
  await client.query(baseSql)
  await client.query(migrationSql)

  const requiredReportColumns = ['resolution', 'resolved_at', 'appeal_note', 'appeal_at', 'appeal_status']
  const columns = await client.query(
    `select column_name
       from information_schema.columns
      where table_schema = $1 and table_name = 'reports' and column_name = any($2::text[])`,
    [schema, requiredReportColumns],
  )
  const found = new Set(columns.rows.map((row) => row.column_name))
  const missing = requiredReportColumns.filter((name) => !found.has(name))
  if (missing.length) throw new Error(`迁移校验失败，reports 缺少字段：${missing.join(', ')}`)

  const requiredTables = ['security_events', 'discovery_exposures', 'relationship_feedback']
  const tables = await client.query(
    `select table_name from information_schema.tables where table_schema = $1 and table_name = any($2::text[])`,
    [schema, requiredTables],
  )
  const foundTables = new Set(tables.rows.map((row) => row.table_name))
  const missingTables = requiredTables.filter((name) => !foundTables.has(name))
  if (missingTables.length) throw new Error(`迁移校验失败，缺少表：${missingTables.join(', ')}`)

  await client.query('commit')
  console.log(`Neon schema migration OK: ${schema}`)
} catch (error) {
  try { await client.query('rollback') } catch {}
  throw error
} finally {
  await client.end().catch(() => {})
}
