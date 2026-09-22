// 备份演练：把生产 schema 的全量数据导出为内存快照，装入一次性隔离 schema，
// 再逐表核对行数与内容指纹，证明「数据能取出、能装回、装回后一致」。
// 全程对生产只读；演练空间结束即销毁。
//
// 用法：NEON_DSN='postgresql://…' node scripts/neon-backup-drill.mjs
import pg from 'pg'
import fs from 'node:fs'
import crypto from 'node:crypto'

const DSN = process.env.NEON_DSN
const DRILL = process.env.DRILL_SCHEMA ?? 'restore_drill'
if (!DSN) {
  console.error('缺少 NEON_DSN 环境变量')
  process.exit(1)
}

const SKIP = new Set(['gateway_meta'])

function fingerprint(rows) {
  const h = crypto.createHash('md5')
  for (const r of rows) h.update(JSON.stringify(r, Object.keys(r).sort()))
  return h.digest('hex').slice(0, 12)
}

async function main() {
  const client = new pg.Client({ connectionString: DSN, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    // 1) 生产只读导出（全限定名，不依赖 search_path：连接池为事务模式，会话设置会泄漏）
    const t = await client.query(
      `select table_name from information_schema.tables where table_schema='public' and table_name <> all($1) order by table_name`,
      [[...SKIP]],
    )
    const tables = t.rows.map((r) => r.table_name)
    const snapshot = {}
    for (const name of tables) {
      const r = await client.query(`select * from public."${name}" order by id`)
      snapshot[name] = r.rows
    }
    const total = Object.values(snapshot).reduce((s, rows) => s + rows.length, 0)
    console.log(`导出：${tables.length} 张表 / ${total} 行（生产只读）`)

    // 2) 建隔离空间并装回（search_path 只在装表事务内生效，事务级设置不泄漏）
    await client.query(`drop schema if exists ${DRILL} cascade`)
    await client.query(`create schema ${DRILL}`)
    await client.query('begin')
    await client.query(`select set_config('search_path', '${DRILL}', true)`)
    await client.query(fs.readFileSync('scripts/neon-schema.sql', 'utf8'))
    await client.query('commit')

    for (const name of tables) {
      const rows = snapshot[name]
      if (!rows.length) continue
      const cols = Object.keys(rows[0])
      const quoted = cols.map((c) => `"${c}"`).join(',')
      for (const row of rows) {
        const vals = cols.map((c) => {
          const v = row[c]
          if (v === null || v === undefined) return null
          if (v instanceof Date) return v.toISOString()
          if (typeof v === 'object') return JSON.stringify(v)
          return v
        })
        const ph = cols.map((_, i) => `$${i + 1}`).join(',')
        await client.query(`insert into ${DRILL}."${name}" (${quoted}) values (${ph})`, vals)
      }
    }
    console.log('装回隔离空间完成，开始逐表核对…')

    // 3) 逐表核对行数 + 内容指纹
    let bad = 0
    for (const name of tables) {
      const src = snapshot[name]
      const dst = await client.query(`select * from ${DRILL}."${name}" order by id`)
      const ok = dst.rows.length === src.length && fingerprint(dst.rows) === fingerprint(src)
      if (!ok) {
        bad++
        console.log(`  ✗ ${name}: 源 ${src.length} 行 / 装回 ${dst.rows.length} 行`)
      } else if (src.length) {
        console.log(`  ✓ ${name}: ${src.length} 行 指纹一致`)
      }
    }

    // 4) 销毁演练空间
    await client.query(`drop schema if exists ${DRILL} cascade`)
    if (bad) {
      console.error(`演练失败：${bad} 张表不一致`)
      process.exit(1)
    }
    console.log(`备份演练通过：${tables.length} 张表全部一致，演练空间已销毁`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
