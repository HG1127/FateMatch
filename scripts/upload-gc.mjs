// 上传资产垃圾回收：引用扫描 + 宽限期 + 默认 dry-run。
// 只治理 v2-* 新资产；历史 unsigned 文件保持兼容，不自动删除。
//
// 手动盘点（只读）：
//   NEON_DSN='postgresql://…' pnpm uploads:gc
// 真正清理（仍受 72h 默认宽限期保护）：
//   UPLOAD_GC_FORCE=yes NEON_DSN='postgresql://…' pnpm uploads:gc
//
// 可选：UPLOAD_GC_SCHEMA / NEON_SCHEMA、UPLOAD_GC_DIR、UPLOAD_GC_GRACE_HOURS。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const V2_UPLOAD_RE = /^v2-(profile|post|event|chat|admin)-[a-z0-9]+-[a-f0-9]{24}\.(jpg|png|webp|gif)$/i
const URL_UPLOAD_RE = /\/api\/uploads\/(v2-(?:profile|post|event|chat|admin)-[a-z0-9]+-[a-f0-9]{24}\.(?:jpg|png|webp|gif))(?:\?[^"'\s)]*)?/gi
const IMAGE_COLUMNS = new Set(['photos', 'images', 'cover', 'covers', 'stories', 'avatar'])

export function collectV2References(value, out = new Set()) {
  if (value == null) return out
  if (typeof value === 'string') {
    URL_UPLOAD_RE.lastIndex = 0
    for (const match of value.matchAll(URL_UPLOAD_RE)) out.add(match[1])
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectV2References(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectV2References(item, out)
  }
  return out
}

export function isManagedV2Upload(name) {
  return V2_UPLOAD_RE.test(String(name ?? ''))
}

function safeIdent(name, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) throw new Error(`${label} 非法`)
  return `"${name}"`
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

export async function scanReferencedUploads(client, schema) {
  safeIdent(schema, 'schema')
  const cols = await client.query(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = $1
        and column_name = any($2::text[])
        and data_type in ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
      order by table_name, ordinal_position`,
    [schema, [...IMAGE_COLUMNS]],
  )

  const refs = new Set()
  for (const { table_name: table, column_name: column } of cols.rows) {
    const t = safeIdent(String(table), 'table')
    const c = safeIdent(String(column), 'column')
    const r = await client.query(`select ${c} as value from ${safeIdent(schema, 'schema')}.${t} where ${c} is not null`)
    for (const row of r.rows) collectV2References(row.value, refs)
  }
  return { refs, scannedColumns: cols.rows.length }
}

async function main() {
  const dsn = process.env.NEON_DSN
  if (!dsn) throw new Error('缺少 NEON_DSN；GC 需要数据库引用扫描，连接串只允许通过环境变量传入')

  const schema = String(process.env.UPLOAD_GC_SCHEMA ?? process.env.NEON_SCHEMA ?? 'public').trim()
  safeIdent(schema, 'UPLOAD_GC_SCHEMA')

  const root = process.cwd()
  const uploadDir = path.resolve(root, process.env.UPLOAD_GC_DIR ?? 'uploads')
  const graceHours = Number(process.env.UPLOAD_GC_GRACE_HOURS ?? 72)
  if (!Number.isFinite(graceHours) || graceHours < 24 || graceHours > 24 * 365) {
    throw new Error('UPLOAD_GC_GRACE_HOURS 必须在 24–8760 小时之间')
  }
  const force = process.env.UPLOAD_GC_FORCE === 'yes'
  const cutoff = Date.now() - graceHours * 3600_000

  if (!fs.existsSync(uploadDir)) {
    console.log(`uploads 不存在：${path.relative(root, uploadDir) || uploadDir}，无需清理`)
    return
  }

  const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  let refs
  let scannedColumns
  try {
    const scanned = await scanReferencedUploads(client, schema)
    refs = scanned.refs
    scannedColumns = scanned.scannedColumns
  } finally {
    await client.end().catch(() => {})
  }

  const allFiles = fs.readdirSync(uploadDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
  const managed = allFiles.filter(isManagedV2Upload)
  const legacyOrOther = allFiles.length - managed.length
  const candidates = []
  let protectedRecent = 0

  for (const name of managed) {
    if (refs.has(name)) continue
    const fp = path.join(uploadDir, name)
    const st = fs.statSync(fp)
    if (st.mtimeMs > cutoff) {
      protectedRecent += 1
      continue
    }
    candidates.push({ name, fp, bytes: st.size, mtimeMs: st.mtimeMs })
  }

  const candidateBytes = candidates.reduce((sum, item) => sum + item.bytes, 0)
  console.log(`上传资产 GC：schema=${schema} mode=${force ? 'DELETE' : 'DRY-RUN'} grace=${graceHours}h`)
  console.log(`引用扫描：${scannedColumns} 个图片字段 / ${refs.size} 个 v2 引用`)
  console.log(`磁盘：${allFiles.length} 个文件；v2=${managed.length}；legacy/other=${legacyOrOther}`)
  console.log(`候选：${candidates.length} 个 / ${fmtBytes(candidateBytes)}；宽限期保护=${protectedRecent} 个`)

  if (!force) {
    for (const item of candidates.slice(0, 20)) {
      console.log(`DRY-RUN ${item.name} ${fmtBytes(item.bytes)} age=${Math.floor((Date.now() - item.mtimeMs) / 3600_000)}h`)
    }
    if (candidates.length > 20) console.log(`…另有 ${candidates.length - 20} 个候选未逐项输出`)
    console.log('未删除任何文件；确认盘点无误后设置 UPLOAD_GC_FORCE=yes')
    return
  }

  // 真删除前重新扫一次引用，覆盖“首次扫描后又有旧 URL 被重新引用”的竞态。
  const verifyClient = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
  await verifyClient.connect()
  let latestRefs
  try {
    latestRefs = (await scanReferencedUploads(verifyClient, schema)).refs
  } finally {
    await verifyClient.end().catch(() => {})
  }

  let deleted = 0
  let freed = 0
  let rescuedByRescan = 0
  for (const item of candidates) {
    if (latestRefs.has(item.name)) {
      rescuedByRescan += 1
      continue
    }
    if (!fs.existsSync(item.fp)) continue
    const st = fs.statSync(item.fp)
    if (st.mtimeMs > cutoff) continue
    fs.unlinkSync(item.fp)
    deleted += 1
    freed += st.size
  }
  console.log(`二次引用复核保护：${rescuedByRescan} 个`)
  console.log(`已删除：${deleted} 个 / ${fmtBytes(freed)}`)
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direct) {
  main().catch((error) => {
    console.error(`上传资产 GC 失败：${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
