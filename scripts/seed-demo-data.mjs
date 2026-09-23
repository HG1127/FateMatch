// 演示数据服务端种子化（v1.7）：把共享演示内容一次性灌入目标库，
// 使「公开表 create 收紧到本人署名 + 掌柜」不再依赖客户端同步种子行（docs/09 残留项 5 的前置）。
//
// 夹具 scripts/demo-seed.json 只含种子用户（u01–u12，与 src/lib/store.tsx seedUsers 一致；
// 本地演示掌柜 adm 不入夹具）署名的演示行，不含任何真实会员数据、不含凭据。
//
// 用法（连接串只经环境变量传入，不落盘）：
//   导出夹具（从源库只读导出）：NEON_DSN='postgresql://…' node scripts/seed-demo-data.mjs --export
//   灌入目标库（幂等，可重复跑）：NEON_DSN='postgresql://…' [NEON_SCHEMA=库名] node scripts/seed-demo-data.mjs
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const FIXTURE_PATH = path.join(process.cwd(), 'scripts', 'demo-seed.json')
const SCHEMA = process.env.NEON_SCHEMA ?? 'public'
const tq = (name) => `"${SCHEMA}"."${name}"`

const SEED_USERS = ['u01', 'u02', 'u03', 'u04', 'u05', 'u06', 'u07', 'u08', 'u09', 'u10', 'u11', 'u12']
const TABLES = ['profiles', 'posts', 'events', 'post_comments', 'event_comments', 'content_likes', 'event_attendees']
const STRIP = new Set(['created', 'updated', 'synced_at'])

async function connect() {
  if (!process.env.NEON_DSN) {
    console.error('缺少 NEON_DSN 环境变量')
    process.exit(1)
  }
  const c = new pg.Client({ connectionString: process.env.NEON_DSN, ssl: { rejectUnauthorized: false } })
  await c.connect()
  return c
}

async function exportFixture() {
  const c = await connect()
  const all = (sql, params) => c.query(sql, params).then((r) => r.rows)
  const out = {
    profiles: await all(`select * from public.profiles where sid = any($1)`, [SEED_USERS]),
    posts: await all(`select * from public.posts where author_sid = any($1)`, [SEED_USERS]),
    // 种子活动为官方内容，creator_sid 为空串
    events: await all(`select * from public.events where creator_sid = '' or creator_sid = any($1)`, [SEED_USERS]),
    post_comments: await all(`select * from public.post_comments where author_sid = any($1)`, [SEED_USERS]),
    event_comments: await all(`select * from public.event_comments where author_sid = any($1)`, [SEED_USERS]),
    content_likes: await all(`select * from public.content_likes where owner_sid = any($1)`, [SEED_USERS]),
    event_attendees: await all(`select * from public.event_attendees where owner_sid = any($1)`, [SEED_USERS]),
  }
  await c.end()
  for (const t of TABLES) {
    out[t] = out[t].map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !STRIP.has(k))))
  }
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(out))
  const kb = (fs.statSync(FIXTURE_PATH).size / 1024).toFixed(1)
  console.log(`夹具已写入 ${FIXTURE_PATH}（${kb} KB）：`)
  for (const t of TABLES) console.log(`  ${t}: ${out[t].length} 行`)
}

async function inject() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    console.error(`缺少夹具 ${FIXTURE_PATH}，先在源库运行 --export`)
    process.exit(1)
  }
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
  const c = await connect()
  try {
    // 连接池为事务模式：search_path 只做事务级设置；表名一律全限定
    await c.query('begin')
    await c.query(`select set_config('search_path', $1, true)`, [SCHEMA])
    for (const t of TABLES) {
      const rows = data[t] ?? []
      let inserted = 0
      for (const row of rows) {
        const names = Object.keys(row)
        const values = Object.values(row).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v))
        const ph = names.map((_, i) => `$${i + 1}`)
        const quoted = names.map((n) => `"${n}"`)
        const r = await c.query(
          `insert into ${tq(t)} (${quoted.join(',')}, created, updated) values (${ph.join(',')}, now(), now()) on conflict do nothing`,
          values,
        )
        inserted += r.rowCount ?? 0
      }
      console.log(`  ${t}: 夹具 ${rows.length} 行，新插入 ${inserted}（其余已存在，幂等跳过）`)
    }
    await c.query('commit')
    console.log(`种子化完成：schema=${SCHEMA}`)
  } catch (e) {
    try { await c.query('rollback') } catch { /* 已断开 */ }
    throw e
  } finally {
    await c.end()
  }
}

if (process.argv.includes('--export')) await exportFixture()
else await inject()
