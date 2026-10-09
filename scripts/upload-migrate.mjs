// 历史 unsigned 上传迁移：把数据库里的旧 /api/uploads/<legacy> 引用改为 v2 capability URL。
// 默认 DRY-RUN；只有 UPLOAD_MIGRATE_FORCE=yes 才会复制文件并事务化更新数据库。
// 旧文件永不由本脚本删除，迁移异常可直接回退数据库，新增 orphan v2 文件后续由 uploads:gc 宽限期治理。
//
// 盘点：
//   NEON_DSN='postgresql://…' pnpm uploads:migrate
// 执行：
//   UPLOAD_MIGRATE_FORCE=yes NEON_DSN='postgresql://…' pnpm uploads:migrate
//
// 可选：UPLOAD_MIGRATE_SCHEMA / NEON_SCHEMA、UPLOAD_MIGRATE_DIR。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const LEGACY_NAME_RE = /^[a-z0-9]+-[a-f0-9]{24}\.(jpg|png|webp|gif)$/i
const LEGACY_URL_RE = /\/api\/uploads\/((?!v2-)[a-z0-9]+-[a-f0-9]{24}\.(?:jpg|png|webp|gif))(?:\?[^"'\s)]*)?/gi

export const IMAGE_TARGETS = [
  { table: 'users', column: 'avatar', purpose: 'profile' },
  { table: 'profiles', column: 'photos', purpose: 'profile' },
  { table: 'posts', column: 'images', purpose: 'post' },
  { table: 'events', column: 'cover', purpose: 'event' },
  { table: 'events', column: 'images', purpose: 'event' },
  { table: 'chat_messages', column: 'images', purpose: 'chat' },
  { table: 'digests', column: 'cover', purpose: 'admin' },
  { table: 'digests', column: 'covers', purpose: 'admin' },
  { table: 'site_settings', column: 'stories', purpose: 'admin' },
]

function safeIdent(name, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(String(name))) throw new Error(`${label} 非法`)
  return `"${name}"`
}

export function isLegacyUploadName(name) {
  return LEGACY_NAME_RE.test(String(name ?? ''))
}

export function deterministicV2Name(purpose, legacyName) {
  if (!['profile', 'post', 'event', 'chat', 'admin'].includes(purpose)) throw new Error('图片用途无效')
  if (!isLegacyUploadName(legacyName)) throw new Error('历史图片文件名无效')
  const ext = path.extname(legacyName).toLowerCase()
  const digest = crypto.createHash('sha256').update(`${purpose}:${legacyName}`).digest('hex').slice(0, 24)
  return `v2-${purpose}-migrate-${digest}${ext}`
}

export function capabilityUrl(name, secret) {
  if (!secret) throw new Error('缺少 capability 签名密钥')
  const sig = crypto.createHmac('sha256', secret).update(`upload:${name}`).digest('base64url').slice(0, 32)
  return `/api/uploads/${name}?sig=${encodeURIComponent(sig)}`
}

export function rewriteLegacyValue(value, purpose, secret, mappings = new Map()) {
  if (value == null) return { value, changed: false, mappings }

  if (typeof value === 'string') {
    let changed = false
    LEGACY_URL_RE.lastIndex = 0
    const next = value.replace(LEGACY_URL_RE, (_whole, legacyName) => {
      const legacy = String(legacyName)
      const key = `${purpose}:${legacy}`
      let mapped = mappings.get(key)
      if (!mapped) {
        const name = deterministicV2Name(purpose, legacy)
        mapped = { purpose, legacyName: legacy, v2Name: name, url: capabilityUrl(name, secret) }
        mappings.set(key, mapped)
      }
      changed = true
      return mapped.url
    })
    return { value: next, changed, mappings }
  }

  if (Array.isArray(value)) {
    let changed = false
    const next = value.map(item => {
      const out = rewriteLegacyValue(item, purpose, secret, mappings)
      changed ||= out.changed
      return out.value
    })
    return { value: next, changed, mappings }
  }

  if (typeof value === 'object') {
    let changed = false
    const next = {}
    for (const [key, item] of Object.entries(value)) {
      const out = rewriteLegacyValue(item, purpose, secret, mappings)
      changed ||= out.changed
      next[key] = out.value
    }
    return { value: next, changed, mappings }
  }

  return { value, changed: false, mappings }
}

async function existingTargets(client, schema) {
  const wanted = new Map(IMAGE_TARGETS.map(x => [`${x.table}:${x.column}`, x]))
  const r = await client.query(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = $1
      order by table_name, ordinal_position`,
    [schema],
  )
  return r.rows
    .map(row => wanted.get(`${row.table_name}:${row.column_name}`))
    .filter(Boolean)
}

async function buildPlan(client, schema, secret) {
  const targets = await existingTargets(client, schema)
  const mappings = new Map()
  const updates = []

  for (const target of targets) {
    const t = safeIdent(target.table, 'table')
    const c = safeIdent(target.column, 'column')
    const rows = await client.query(
      `select id, ${c} as value from ${safeIdent(schema, 'schema')}.${t} where ${c} is not null`,
    )
    for (const row of rows.rows) {
      const rewritten = rewriteLegacyValue(row.value, target.purpose, secret, mappings)
      if (!rewritten.changed) continue
      updates.push({
        table: target.table,
        column: target.column,
        id: String(row.id),
        oldValue: row.value,
        newValue: rewritten.value,
      })
    }
  }

  return { targets, mappings: [...mappings.values()], updates }
}

function assertFilesAvailable(uploadDir, mappings) {
  const missing = []
  for (const item of mappings) {
    const src = path.join(uploadDir, item.legacyName)
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) missing.push(item.legacyName)
  }
  if (missing.length) {
    throw new Error(`有 ${missing.length} 个数据库引用找不到对应旧文件：${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`)
  }
}

function copyV2Files(uploadDir, mappings) {
  let copied = 0
  let existing = 0
  for (const item of mappings) {
    const src = path.join(uploadDir, item.legacyName)
    const dest = path.join(uploadDir, item.v2Name)
    if (fs.existsSync(dest)) {
      const a = fs.statSync(src)
      const b = fs.statSync(dest)
      if (a.size !== b.size) throw new Error(`目标文件已存在但大小不同：${item.v2Name}`)
      const srcHash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')
      const destHash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')
      if (srcHash !== destHash) throw new Error(`目标文件已存在但内容不同：${item.v2Name}`)
      existing += 1
      continue
    }
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL)
    copied += 1
  }
  return { copied, existing }
}

async function applyUpdates(client, schema, secret, updates) {
  await client.query('begin')
  try {
    for (const item of updates) {
      const t = safeIdent(item.table, 'table')
      const c = safeIdent(item.column, 'column')
      const encoded = typeof item.newValue === 'object' && item.newValue !== null ? JSON.stringify(item.newValue) : item.newValue
      const r = await client.query(
        `update ${safeIdent(schema, 'schema')}.${t}
            set ${c} = $1, updated = now()
          where id = $2`,
        [encoded, item.id],
      )
      if (r.rowCount !== 1) throw new Error(`迁移更新失败：${item.table}.${item.column} id=${item.id}`)
    }
    // COMMIT 前复核。当前事务能看到自己的写入；若仍有旧引用，整笔回滚。
    const verify = await buildPlan(client, schema, secret)
    if (verify.updates.length) {
      throw new Error(`迁移复核失败：仍检测到 ${verify.updates.length} 条旧 URL 引用`)
    }
    await client.query('commit')
  } catch (error) {
    try { await client.query('rollback') } catch {}
    throw error
  }
}

async function main() {
  const dsn = process.env.NEON_DSN
  if (!dsn) throw new Error('缺少 NEON_DSN；迁移必须先扫描真实数据库引用')
  const schema = String(process.env.UPLOAD_MIGRATE_SCHEMA ?? process.env.NEON_SCHEMA ?? 'public').trim()
  safeIdent(schema, 'UPLOAD_MIGRATE_SCHEMA')
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_MIGRATE_DIR ?? 'uploads')
  const force = process.env.UPLOAD_MIGRATE_FORCE === 'yes'

  if (!fs.existsSync(uploadDir)) throw new Error(`uploads 目录不存在：${uploadDir}`)

  const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const secretRow = await client.query(
      `select value from ${safeIdent(schema, 'schema')}.${safeIdent('gateway_meta', 'table')} where key = 'jwt_secret' limit 1`,
    )
    const secret = String(secretRow.rows[0]?.value ?? '')
    if (!secret) throw new Error('gateway_meta.jwt_secret 不存在，不能生成与网关一致的 capability URL')

    const plan = await buildPlan(client, schema, secret)
    assertFilesAvailable(uploadDir, plan.mappings)

    console.log(`历史图片迁移：schema=${schema} mode=${force ? 'APPLY' : 'DRY-RUN'}`)
    console.log(`扫描字段：${plan.targets.length}；待改数据库记录：${plan.updates.length}；旧文件映射：${plan.mappings.length}`)
    for (const item of plan.mappings.slice(0, 20)) console.log(`${force ? 'PLAN' : 'DRY-RUN'} ${item.purpose} ${item.legacyName} -> ${item.v2Name}`)
    if (plan.mappings.length > 20) console.log(`…另有 ${plan.mappings.length - 20} 个映射未逐项输出`)

    if (!force) {
      console.log('未复制文件、未修改数据库；确认盘点无误后设置 UPLOAD_MIGRATE_FORCE=yes')
      return
    }

    const copies = copyV2Files(uploadDir, plan.mappings)
    await applyUpdates(client, schema, secret, plan.updates)
    console.log(`迁移完成：复制新文件=${copies.copied}，复用已存在新文件=${copies.existing}，更新记录=${plan.updates.length}`)
    console.log('旧文件保留不删除；确认线上读取正常并完成备份后，再由独立治理流程决定是否清理 legacy 文件。')
  } finally {
    await client.end().catch(() => {})
  }
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direct) {
  main().catch(error => {
    console.error(`历史图片迁移失败：${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
