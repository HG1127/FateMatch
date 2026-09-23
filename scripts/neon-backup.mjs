// 每日自动备份（v1.9）：数据库全量导出 JSON + uploads/ 附件归档，落 backups/（已 gitignore），
// 保留最近 N 份。导出格式与备份演练脚本一致（{表名: 行数组}，跳过 gateway_meta 密钥表），
// 可直接用演练脚本的装回逻辑做恢复验证。
//
// 由看门狗每日定时调度（连接串经环境变量传入，不落盘）；也可手动运行：
//   NEON_DSN='postgresql://…' node scripts/neon-backup.mjs
// 可选环境变量：BACKUP_DIR（默认 backups）、BACKUP_KEEP（默认 7）、BACKUP_SCHEMA（默认 public）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import pg from 'pg'

const DSN = process.env.NEON_DSN
if (!DSN) {
  console.error('缺少 NEON_DSN 环境变量')
  process.exit(1)
}
const DIR = process.env.BACKUP_DIR ?? 'backups'
const KEEP = Number(process.env.BACKUP_KEEP ?? 7)
const SCHEMA = process.env.BACKUP_SCHEMA ?? 'public'
const SKIP = new Set(['gateway_meta']) // 会话签名密钥不随备份落文件（与后台导出约定一致）

const today = new Date().toISOString().slice(0, 10)
fs.mkdirSync(DIR, { recursive: true })

// 1) 数据库全量导出（生产只读；全限定表名，不依赖 search_path）
const client = new pg.Client({ connectionString: DSN, ssl: { rejectUnauthorized: false } })
await client.connect()
const t = await client.query(
  `select table_name from information_schema.tables where table_schema = $1 and table_name <> all($2) order by table_name`,
  [SCHEMA, [...SKIP]],
)
const snapshot = {}
let total = 0
for (const { table_name: name } of t.rows) {
  const r = await client.query(`select * from "${SCHEMA}"."${name}" order by id`)
  snapshot[name] = r.rows
  total += r.rows.length
}
await client.end()
const dbFile = path.join(DIR, `db-${today}.json`)
fs.writeFileSync(dbFile, JSON.stringify(snapshot))
console.log(`备份：${t.rows.length} 张表 / ${total} 行 -> ${dbFile}（${(fs.statSync(dbFile).size / 1024).toFixed(1)} KB）`)

// 2) 附件目录归档（存在且非空才打包）
const uploadsDir = 'uploads'
if (fs.existsSync(uploadsDir) && fs.readdirSync(uploadsDir).length) {
  const upFile = path.join(DIR, `uploads-${today}.tar`)
  execFileSync('tar', ['-cf', upFile, uploadsDir], { stdio: 'ignore' })
  console.log(`附件：${fs.readdirSync(uploadsDir).length} 个文件 -> ${upFile}（${(fs.statSync(upFile).size / 1024).toFixed(1)} KB）`)
} else {
  console.log('附件：uploads/ 为空，跳过归档')
}

// 3) 代码库全历史打包（bundle 可用 git clone 直接还原；异地容灾仍以推送 GitHub 为准）
try {
  const bundleFile = path.join(DIR, `repo-${today}.bundle`)
  execFileSync('git', ['bundle', 'create', bundleFile, '--all'], { stdio: 'ignore' })
  console.log(`代码库：全历史 -> ${bundleFile}（${(fs.statSync(bundleFile).size / 1024).toFixed(1)} KB）`)
} catch {
  console.log('代码库：git bundle 失败（跳过，不影响数据备份）')
}

// 4) 保留策略：各类只留最近 KEEP 份
for (const prefix of ['db-', 'uploads-', 'repo-']) {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.startsWith(prefix))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    fs.unlinkSync(path.join(DIR, f))
    console.log(`清理过期备份：${f}`)
  }
}
console.log('备份完成')
