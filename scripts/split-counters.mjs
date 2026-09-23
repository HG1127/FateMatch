// 计数拆分迁移：把内嵌名单列拆到独立关系表（幂等，可重复跑）。
//   posts.likes / post_comments.likes / event_comments.likes -> content_likes
//   events.attendees                                        -> event_attendees
// 旧列保留不删（回退兜底），迁移后由网关屏蔽读写，新表是唯一数据源。
// digests.views 不迁移：保留原列，改由网关浏览端点原子自增。
//
// 用法：NEON_DSN='postgresql://…' node scripts/split-counters.mjs [--dry]
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'

const DSN = process.env.NEON_DSN
const DRY = process.argv.includes('--dry')
if (!DSN) {
  console.error('缺少 NEON_DSN 环境变量')
  process.exit(1)
}

const asArray = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])

async function main() {
  const client = new pg.Client({ connectionString: DSN, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    // 1) 建新表（DDL 与 neon-schema.sql 保持一致；全限定名，不碰 search_path）
    if (!DRY) {
      const ddl = fs.readFileSync(path.join('scripts', 'neon-schema.sql'), 'utf8')
      const only = ddl
        .split(/;\s*\n/)
        .filter((s) => /content_likes|event_attendees/.test(s))
        .join(';\n')
      await client.query(only)
    }

    // 2) 展开名单
    const likeSources = [
      { table: 'posts', kind: 'post' },
      { table: 'post_comments', kind: 'post_comment' },
      { table: 'event_comments', kind: 'event_comment' },
    ]
    let likeRows = 0
    for (const { table, kind } of likeSources) {
      const r = await client.query(`select sid, likes from public."${table}"`)
      let n = 0
      for (const row of r.rows) {
        for (const owner of new Set(asArray(row.likes))) {
          const sid = `${kind}:${row.sid}:${owner}`
          n++
          if (!DRY) {
            await client.query(
              `insert into public.content_likes (id, sid, kind, target_sid, owner_sid)
               values ($1,$1,$2,$3,$4) on conflict (id) do nothing`,
              [sid, kind, row.sid, owner],
            )
          }
        }
      }
      console.log(`  ${table}.likes -> content_likes(kind=${kind}): ${n} 条`)
      likeRows += n
    }

    const ev = await client.query(`select sid, attendees from public.events`)
    let attRows = 0
    for (const row of ev.rows) {
      for (const owner of new Set(asArray(row.attendees))) {
        const sid = `${row.sid}:${owner}`
        attRows++
        if (!DRY) {
          await client.query(
            `insert into public.event_attendees (id, sid, event_sid, owner_sid)
             values ($1,$1,$2,$3) on conflict (id) do nothing`,
            [sid, row.sid, owner],
          )
        }
      }
    }
    console.log(`  events.attendees -> event_attendees: ${attRows} 条`)

    // 3) 核对
    if (!DRY) {
      const cl = await client.query(`select count(*)::int n from public.content_likes`)
      const ea = await client.query(`select count(*)::int n from public.event_attendees`)
      console.log(`核对：content_likes ${cl.rows[0].n} 行（源名单去重后 ${likeRows}）、event_attendees ${ea.rows[0].n} 行（源 ${attRows}）`)
      if (cl.rows[0].n < likeRows || ea.rows[0].n < attRows) {
        console.error('行数少于源名单，请检查')
        process.exit(1)
      }
    }
    console.log(DRY ? '试跑完成（未写入）' : '迁移完成：旧列保留但已由网关屏蔽读写')
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
