// Neon 数据镜像：把应用数据服务里的全量数据同步到自建 Neon（Postgres），
// 每张集合对应一张 Postgres 表，可查询、可导出，作为异地镜像与迁移数据源。
// 线上数据服务保持不动，本脚本只读本地 + 写 Neon，失败重试即可。
//
// 用法（容器内）：
//   NEON_DSN='postgresql://user:pass@ep-xxx-pooler.neon.tech/neondb?sslmode=require' \
//   PB_ADMIN=<管理邮箱> PB_PASS=<管理密码> \
//   node scripts/neon-sync.mjs [--dry]
//
// --dry 只读本地数据并打印各表行数与推断出的列结构，不连 Neon。密钥只走环境变量，不落盘不进前端。
import pg from 'pg'

const PB = process.env.PB_URL ?? 'http://127.0.0.1:7000'
const DRY = process.argv.includes('--dry')

const STRIP_FIELDS = ['tokenKey', 'collectionId', 'collectionName', 'collection_id', 'collection_name'] // 会话签名与系统归属字段不进镜像

async function pbJson(path, token, init) {
  const res = await fetch(`${PB}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

/** 读取数据服务全部业务表（跳过头部系统表），返回 { 表名: [行…] } */
async function readAll(token) {
  const cols = await pbJson('/api/collections?perPage=200', token)
  const names = cols.items.map((c) => c.name).filter((n) => !n.startsWith('_'))
  const out = {}
  for (const name of names) {
    const rows = []
    for (let page = 1; ; page++) {
      const batch = await pbJson(
        `/api/collections/${name}/records?perPage=500&page=${page}`,
        token,
      )
      for (const r of batch.items) {
        for (const f of STRIP_FIELDS) delete r[f]
        rows.push(r)
      }
      if (page >= batch.totalPages) break
    }
    out[name] = rows
    console.log(`  ${name}: ${rows.length} 行`)
  }
  return out
}

/** 列名规整：camelCase -> snake_case 小写，与 scripts/neon-schema.sql 保持一致 */
function colName(k) {
  const snake = k.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase()).replace(/[^a-z0-9_]/gi, '_')
  return snake.slice(0, 60)
}

/** users 表的密码字段落库列名 */
function mapCol(table, key) {
  if (table === 'users' && key === 'password') return 'password_hash'
  return colName(key)
}

/** 按整列取值推断类型：全字符串→text，全数字→double precision，全布尔→boolean，其余→jsonb */
function inferType(rows, key) {
  let kind = null
  for (const r of rows) {
    const v = r[key]
    if (v === null || v === undefined) continue
    const t = Array.isArray(v) || typeof v === 'object' ? 'jsonb' : typeof v
    const mapped = t === 'string' ? 'text' : t === 'number' ? 'double precision' : t === 'boolean' ? 'boolean' : 'jsonb'
    if (kind === null) kind = mapped
    else if (kind !== mapped) { kind = 'jsonb'; break }
  }
  return kind ?? 'text'
}

function castValue(v, type) {
  if (v === null || v === undefined) return null
  return type === 'jsonb' ? JSON.stringify(v) : v
}

/** 把一张表镜像进 Neon：建表/补列 → 逐行 upsert → 删掉源头已不存在的行 */
async function mirrorTable(client, name, rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'id')
  const schema = keys.map((k) => ({ col: mapCol(name, k), key: k, type: inferType(rows, k) }))

  const colDefs = schema.map((c) => `"${c.col}" ${c.type}`).join(', ')
  await client.query(
    `CREATE TABLE IF NOT EXISTS "${name}" (id text PRIMARY KEY${colDefs ? ', ' + colDefs : ''}, synced_at timestamptz NOT NULL DEFAULT now())`,
  )
  await client.query(`ALTER TABLE "${name}" ADD COLUMN IF NOT EXISTS synced_at timestamptz NOT NULL DEFAULT now()`)
  for (const c of schema) {
    await client.query(`ALTER TABLE "${name}" ADD COLUMN IF NOT EXISTS "${c.col}" ${c.type}`)
  }

  const cols = ['id', ...schema.map((c) => `"${c.col}"`)]
  for (const r of rows) {
    const vals = [r.id, ...schema.map((c) => castValue(r[c.key], c.type))]
    const ph = vals.map((_, i) => `$${i + 1}`).join(', ')
    const upd = cols.slice(1).map((c) => `${c} = EXCLUDED.${c}`).join(', ')
    await client.query(
      `INSERT INTO "${name}" (${cols.join(', ')}, synced_at) VALUES (${ph}, now())
       ON CONFLICT (id) DO UPDATE SET ${upd ? upd + ', ' : ''}synced_at = now()`,
      vals,
    )
  }
  // 源头已删除的行同步删除，保持镜像一致
  await client.query(`DELETE FROM "${name}" WHERE id <> ALL($1::text[])`, [rows.map((r) => r.id)])
  return schema
}

async function main() {
  const admin = process.env.PB_ADMIN
  const pass = process.env.PB_PASS
  if (!admin || !pass) throw new Error('缺少 PB_ADMIN / PB_PASS 环境变量')

  const auth = await pbJson('/api/collections/_superusers/auth-with-password', null, {
    method: 'POST',
    body: JSON.stringify({ identity: admin, password: pass }),
  })
  const data = await readAll(auth.token)

  // 账号密码哈希补全：管理接口不返回 password 字段，从底层存储只读取出，
  // 保证迁移后老账号可以用原密码登录（网关按同一哈希校验）。
  const PB_DB = process.env.PB_DB ?? '/workspace/pocketbase-bin/pb_data/data.db'
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(PB_DB, { readOnly: true })
    const hashes = db.prepare('select id, password from users').all()
    db.close()
    const byId = new Map(hashes.map((r) => [r.id, r.password]))
    for (const u of data.users ?? []) {
      const h = byId.get(u.id)
      if (h) u.password = h
    }
    console.log(`  已补全 ${hashes.length} 个账号的密码哈希`)
  } catch (e) {
    console.warn(`  警告：读取密码哈希失败（${e.message}），老账号密码将无法迁移`)
  }

  const names = Object.keys(data)
  const total = names.reduce((s, n) => s + data[n].length, 0)
  console.log(`共 ${names.length} 张表 / ${total} 行`)

  if (DRY) {
    for (const n of names) {
      const keys = [...new Set(data[n].flatMap((r) => Object.keys(r)))].filter((k) => k !== 'id')
      const cols = keys.map((k) => `${mapCol(n, k)}:${inferType(data[n], k)}`)
      console.log(`  [dry] ${n} → (${cols.join(', ') || '仅 id'})`)
    }
    console.log('--dry：未连接 Neon')
    return
  }

  const dsn = process.env.NEON_DSN
  if (!dsn) throw new Error('缺少 NEON_DSN 环境变量')

  const client = new pg.Client({ connectionString: dsn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    for (const n of names) {
      await mirrorTable(client, n, data[n])
      console.log(`  ✓ ${n} 已镜像 ${data[n].length} 行`)
    }
    const v = await client.query('select version()')
    console.log(`Neon 同步完成：${v.rows[0].version.split(',')[0]}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
