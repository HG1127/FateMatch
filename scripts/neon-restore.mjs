// 备份文件一键恢复（v1.11）：把每日自动备份的 JSON 装回目标 schema，事务内清表重灌、逐表核对行数。
// 备份三件套至此闭环：每日自动备份（产出）→ 每周自动演练（验证线上导出→装回一致）→ 本脚本（从备份文件真恢复）。
//
// 用法（连接串只经环境变量传入，不落盘）：
//   恢复到隔离 schema（目标库需先按 scripts/neon-schema.sql 建表）：
//     NEON_DSN='postgresql://…' RESTORE_SCHEMA=restore_tmp node scripts/neon-restore.mjs
//   指定备份文件（默认取 backups/ 下最新 db-*.json）：
//     RESTORE_FILE=backups/db-2026-09-23.json RESTORE_SCHEMA=restore_tmp NEON_DSN=… node scripts/neon-restore.mjs
//   附件恢复：tar -xf backups/uploads-<日期>.tar（解回 uploads/ 后重启网关即可）
//
// 安全闸：必须显式指定 RESTORE_SCHEMA；目标为生产 schema public 时另需 RESTORE_FORCE=yes，
// 且应先停网关（kill 看门狗与其子进程）避免恢复期间写入冲突。
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const SCHEMA = process.env.RESTORE_SCHEMA ?? ''
const FORCE = process.env.RESTORE_FORCE === 'yes'

if (!process.env.NEON_DSN) {
  console.error('缺少 NEON_DSN 环境变量')
  process.exit(1)
}
if (!SCHEMA) {
  console.error('缺少 RESTORE_SCHEMA（目标 schema 名）；为防误覆盖，不做默认目标')
  process.exit(1)
}
if (SCHEMA === 'public' && !FORCE) {
  console.error('目标为生产 schema public：需显式 RESTORE_FORCE=yes，并先停网关（看门狗会否则自动拉起）')
  process.exit(1)
}
if (!/^[a-z_][a-z0-9_]*$/i.test(SCHEMA)) {
  console.error(`非法 schema 名：${SCHEMA}`)
  process.exit(1)
}

// 选备份文件：显式指定，或 backups/ 下最新一份 db-*.json
let file = process.env.RESTORE_FILE ?? ''
if (!file) {
  const cands = fs.existsSync('backups')
    ? fs.readdirSync('backups').filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    : []
  if (!cands.length) {
    console.error('backups/ 下没有 db-*.json 备份文件')
    process.exit(1)
  }
  file = path.join('backups', cands[cands.length - 1])
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
const tables = Object.keys(data)
const totalRows = Object.values(data).reduce((s, rows) => s + rows.length, 0)
console.log(`备份文件：${file}（${tables.length} 张表 / ${totalRows} 行）-> schema ${SCHEMA}`)

/** JSON 里的对象/数组（jsonb 列）显式串化；时间戳已是 ISO 串直接可用 */
const prep = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)

const c = new pg.Client({ connectionString: process.env.NEON_DSN, ssl: { rejectUnauthorized: false } })
await c.connect()
try {
  // 连接池为事务模式：search_path 只做事务级设置；表名一律全限定
  await c.query('begin')
  await c.query(`select set_config('search_path', $1, true)`, [SCHEMA])
  for (const t of tables) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(t)) throw new Error(`备份内含非法表名：${t}`)
    await c.query(`delete from "${SCHEMA}"."${t}"`)
    for (const row of data[t]) {
      const names = Object.keys(row)
      const values = names.map((k) => prep(row[k]))
      const ph = names.map((_, i) => `$${i + 1}`)
      const quoted = names.map((n) => `"${n}"`)
      await c.query(`insert into "${SCHEMA}"."${t}" (${quoted.join(',')}) values (${ph.join(',')})`, values)
    }
  }
  // 逐表核对行数，不一致整体回滚
  for (const t of tables) {
    const n = (await c.query(`select count(*)::int n from "${SCHEMA}"."${t}"`)).rows[0].n
    if (n !== data[t].length) throw new Error(`${t} 行数不一致：期望 ${data[t].length}，实际 ${n}`)
  }
  await c.query('commit')
  console.log(`恢复完成：schema=${SCHEMA}，${tables.length} 张表行数全部核对一致（gateway_meta 密钥表不在备份内，未触碰）`)
} catch (e) {
  try { await c.query('rollback') } catch { /* 已断开 */ }
  console.error(`恢复失败已回滚：${e.message}`)
  process.exitCode = 1
} finally {
  await c.end()
}
