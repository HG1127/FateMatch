// Neon 直连数据网关：在容器 7000 端口提供与原数据服务完全一致的 REST 接口，
// 底层存储换成 Neon(Postgres)。前端与外部代理零改动。
//
// 启动（密钥只走环境变量，不落盘不进仓库）：
//   NEON_DSN='postgresql://…?sslmode=require' node server/neon-gateway.mjs
// 可选：PORT（默认 7000）。
//
// 实现的接口语义与权限规则 1:1 复刻自原数据服务（规则快照见 docs/09），
// 包括：公开表全量可读、私有表按属主过滤、管理员表仅管理员可见。
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const PORT = Number(process.env.PORT ?? 7000)
const DSN = process.env.NEON_DSN
if (!DSN) {
  console.error('缺少 NEON_DSN 环境变量')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: DSN,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 60000,
})

/** 带重试的查询：外网出口偶发抖动时自动重连 */
async function q(text, params) {
  let last
  for (let i = 0; i < 3; i++) {
    try {
      return await pool.query(text, params)
    } catch (e) {
      last = e
      const transient = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|terminated|timeout/i.test(String(e.message))
      if (!transient || i === 2) throw e
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw last
}

// ---------- 表结构元数据 ----------

/** table -> Map(column -> data_type) */
const COLUMNS = new Map()

async function loadColumns() {
  const r = await q(
    `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`,
  )
  COLUMNS.clear()
  for (const row of r.rows) {
    if (!COLUMNS.has(row.table_name)) COLUMNS.set(row.table_name, new Map())
    COLUMNS.get(row.table_name).set(row.column_name, row.data_type)
  }
}

// 列名 <-> 原接口字段名（仅 users 表存在 camelCase 字段）
const OUT_ALIAS = { users: { email_visibility: 'emailVisibility' } }
const IN_ALIAS = { users: { emailVisibility: 'email_visibility', password: 'password_hash' } }
const HIDDEN = new Set(['password_hash', 'synced_at'])

// ---------- 权限规则（与原数据服务逐条一致） ----------

const A = 'auth' // 任意登录用户
const ADMIN = 'admin' // 仅管理员
const SELF = 'self' // 仅本人（users.id）
const OPEN = 'open' // 公开
const DENY = 'deny'
const me = (f) => ({ f }) // 字段 = 当前用户 id

const RULES = {
  users: { list: SELF, view: SELF, create: OPEN, update: SELF, delete: SELF },
  profiles: { list: OPEN, view: OPEN, create: A, update: [me('sid'), ADMIN], delete: ADMIN },
  posts: { list: OPEN, view: OPEN, create: A, update: A, delete: ADMIN },
  post_comments: { list: OPEN, view: OPEN, create: A, update: A, delete: ADMIN },
  events: { list: OPEN, view: OPEN, create: A, update: A, delete: ADMIN },
  event_comments: { list: OPEN, view: OPEN, create: A, update: A, delete: ADMIN },
  chat_messages: { list: A, view: A, create: [me('sid_a'), me('sid_b'), ADMIN], update: [me('sid_a'), me('sid_b'), ADMIN], delete: [me('from_sid'), ADMIN] },
  user_likes: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  user_passes: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: A, update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  user_reads: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: A, update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  favorites: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: A, update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  fav_groups: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: A, update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  visits: { list: [me('viewer_sid'), me('viewed_sid'), ADMIN], view: [me('viewer_sid'), me('viewed_sid'), ADMIN], create: [me('viewer_sid')], update: [me('viewer_sid')], delete: [me('viewer_sid'), ADMIN] },
  blocks: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: A, update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  reminders: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: A, update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  checkins: { list: A, view: A, create: A, update: A, delete: A },
  contacts: { list: A, view: A, create: [me('user_sid')], update: [me('user_sid')], delete: [me('user_sid'), ADMIN] },
  reports: { list: [me('by_sid'), ADMIN], view: [me('by_sid'), ADMIN], create: [me('by_sid')], update: A, delete: ADMIN },
  digests: { list: OPEN, view: OPEN, create: A, update: A, delete: ADMIN },
  admin_logs: { list: ADMIN, view: ADMIN, create: ADMIN, update: ADMIN, delete: ADMIN },
  site_settings: { list: OPEN, view: OPEN, create: ADMIN, update: ADMIN, delete: DENY },
  user_tour: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: A, update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
}

// ---------- JWT（HS256，密钥存 Neon gateway_meta，重启不掉登录态） ----------

const b64u = (b) => Buffer.from(b).toString('base64url')

let JWT_SECRET = ''

async function loadSecret() {
  await q(`create table if not exists gateway_meta (key text primary key, value text not null)`)
  const gen = crypto.randomBytes(32).toString('hex')
  await q(`insert into gateway_meta (key, value) values ('jwt_secret', $1) on conflict (key) do nothing`, [gen])
  const r = await q(`select value from gateway_meta where key = 'jwt_secret'`)
  JWT_SECRET = r.rows[0].value
}

function signToken(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

function verifyToken(token) {
  try {
    const [head, body, sig] = String(token).split('.')
    if (!head || !body || !sig) return null
    const want = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')
    const a = Buffer.from(sig)
    const b = Buffer.from(want)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

// ---------- 工具 ----------

class HttpErr extends Error {
  constructor(status, message, data = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

const genId = () => {
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 15; i++) s += alpha[crypto.randomInt(alpha.length)]
  return s
}

/** PB 风格时间串：2026-09-08 12:34:56.789Z */
function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toISOString().replace('T', ' ')
}

function colIdOf(table) {
  return crypto.createHash('md5').update(`suiyuan:${table}`).digest('hex').slice(0, 15)
}

/** DB 行 -> 接口记录（字段名与原数据服务一致） */
function toRecord(table, row) {
  const cols = COLUMNS.get(table) ?? new Map()
  const rec = { id: row.id, collectionId: colIdOf(table), collectionName: table }
  for (const [col] of cols) {
    if (col === 'id' || col === 'created' || col === 'updated' || HIDDEN.has(col)) continue
    const out = OUT_ALIAS[table]?.[col] ?? col
    rec[out] = row[col] ?? null
  }
  rec.created = fmtDate(row.created)
  rec.updated = fmtDate(row.updated)
  return rec
}

/** 请求体字段 -> DB 列（未知字段忽略） */
function bodyToCols(table, body) {
  const cols = COLUMNS.get(table)
  if (!cols) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  const out = new Map()
  for (const [k, v] of Object.entries(body ?? {})) {
    if (['id', 'created', 'updated', 'passwordConfirm', 'oldPassword'].includes(k)) continue
    const col = IN_ALIAS[table]?.[k] ?? k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
    if (!cols.has(col) || HIDDEN.has(col)) continue
    out.set(col, v)
  }
  return out
}

function castParam(colType, v) {
  if (v === null || v === undefined) return null
  if (colType === 'jsonb') return JSON.stringify(v)
  if (colType === 'boolean') return Boolean(v)
  return v
}

/** 当前请求的登录态：{ id, role } 或 null */
async function resolveAuth(req) {
  const raw = req.headers['authorization'] || req.headers['x-pb-auth'] || ''
  const token = String(raw).replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload?.id) return null
  const r = await q(`select role from profiles where sid = $1 limit 1`, [payload.id])
  return { id: payload.id, role: r.rows[0]?.role === 'admin' ? 'admin' : undefined }
}

function needAuth(auth) {
  if (!auth) throw new HttpErr(403, 'You are not allowed to perform this operation.')
  return auth
}

/** 行级规则判定 */
function allowRow(rule, row, auth) {
  if (rule === OPEN || rule === 'public') return true
  if (rule === DENY) return false
  if (rule === A) return !!auth
  if (rule === SELF) return !!auth && row.id === auth.id
  if (rule === ADMIN) return auth?.role === 'admin'
  if (Array.isArray(rule)) {
    if (!auth) return false
    return rule.some((c) => (c === ADMIN ? auth.role === 'admin' : String(row[c.f] ?? '') === auth.id))
  }
  return false
}

/** 建表规则判定（对提交数据判定，与原服务一致） */
function allowCreate(rule, data, auth) {
  if (rule === OPEN || rule === 'public') return true
  if (rule === DENY) return false
  if (rule === A) return !!auth
  if (rule === SELF) return false
  if (rule === ADMIN) return auth?.role === 'admin'
  if (Array.isArray(rule)) {
    if (!auth) return false
    return rule.some((c) => (c === ADMIN ? auth.role === 'admin' : String(data[c.f] ?? '') === auth.id))
  }
  return false
}

/** 列表范围 -> WHERE 子句 */
function scopeWhere(rule, auth) {
  if (rule === OPEN) return null
  if (rule === A) { needAuth(auth); return null }
  if (rule === SELF) { needAuth(auth); return { sql: 'id = $1', params: [auth.id] } }
  if (rule === ADMIN) {
    needAuth(auth)
    if (auth.role === 'admin') return null
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  if (Array.isArray(rule)) {
    needAuth(auth)
    if (rule.includes(ADMIN) && auth.role === 'admin') return null
    const conds = rule.filter((c) => c !== ADMIN).map((c) => `"${c.f}" = $1`)
    return { sql: `(${conds.join(' or ')})`, params: [auth.id] }
  }
  throw new HttpErr(403, 'You are not allowed to perform this operation.')
}

// ---------- 业务处理 ----------

async function handleList(table, url, req, auth) {
  const cols = COLUMNS.get(table)
  if (!cols) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const perPage = Math.min(500, Math.max(1, Number(url.searchParams.get('perPage') ?? 30)))
  const scope = scopeWhere(RULES[table].list, auth)
  const where = scope ? `where ${scope.sql}` : ''
  const params = scope ? [...scope.params] : []
  const cnt = await q(`select count(*)::int n from "${table}" ${where}`, params)
  const totalItems = cnt.rows[0].n
  const r = await q(
    `select * from "${table}" ${where} order by created asc, id asc limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, perPage, (page - 1) * perPage],
  )
  return {
    page,
    perPage,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
    items: r.rows.map((row) => toRecord(table, row)),
  }
}

async function handleViewOne(table, id, auth) {
  const r = await q(`select * from "${table}" where id = $1`, [id])
  if (!r.rows[0]) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  if (!allowRow(RULES[table].view, r.rows[0], auth)) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  return toRecord(table, r.rows[0])
}

async function handleCreate(table, body, auth) {
  if (!allowCreate(RULES[table].create, body ?? {}, auth)) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  const cols = COLUMNS.get(table)
  const data = bodyToCols(table, body)
  const id = typeof body?.id === 'string' && body.id ? body.id : genId()

  if (table === 'users') {
    // 注册：与原有约束一致（密码 ≥8 位、两次一致、邮箱唯一）
    const email = String(body?.email ?? '').trim().toLowerCase()
    const password = String(body?.password ?? '')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpErr(400, 'Validation failed.', { email: { message: '邮箱格式不正确' } })
    }
    if (password.length < 8) {
      throw new HttpErr(400, 'Validation failed.', { password: { message: '密码至少 8 位' } })
    }
    if (body?.passwordConfirm !== undefined && body.passwordConfirm !== password) {
      throw new HttpErr(400, 'Validation failed.', { passwordConfirm: { message: '两次输入的密码不一致' } })
    }
    const dup = await q(`select 1 from users where lower(email) = $1`, [email])
    if (dup.rows[0]) {
      throw new HttpErr(400, 'Validation failed.', { email: { message: '该邮箱已注册' } })
    }
    const hash = bcrypt.hashSync(password, 10)
    await q(
      `insert into users (id, email, password_hash, name, avatar, email_visibility, verified, created, updated)
       values ($1,$2,$3,$4,$5,false,false,now(),now())`,
      [id, email, hash, String(body?.name ?? ''), ''],
    )
  } else {
    const names = ['id', ...data.keys()]
    const values = [id, ...[...data.entries()].map(([c, v]) => castParam(cols.get(c), v))]
    const ph = names.map((_, i) => `$${i + 1}`)
    const quoted = names.map((n) => `"${n}"`)
    await q(
      `insert into "${table}" (${quoted.join(',')}, created, updated) values (${ph.join(',')}, now(), now())`,
      values,
    )
  }
  const r = await q(`select * from "${table}" where id = $1`, [id])
  return toRecord(table, r.rows[0])
}

async function handleUpdate(table, id, body, auth) {
  const r = await q(`select * from "${table}" where id = $1`, [id])
  if (!r.rows[0]) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  const existing = r.rows[0]
  if (!allowRow(RULES[table].update, existing, auth)) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  const cols = COLUMNS.get(table)

  if (table === 'users' && body?.password) {
    // 改密码：必须验证旧密码，两次新密码一致
    const oldOk = body.oldPassword && bcrypt.compareSync(String(body.oldPassword), existing.password_hash ?? '')
    if (!oldOk) throw new HttpErr(400, 'Validation failed.', { oldPassword: { message: '旧密码不正确' } })
    if (String(body.password).length < 8) {
      throw new HttpErr(400, 'Validation failed.', { password: { message: '密码至少 8 位' } })
    }
    if (body.passwordConfirm !== undefined && body.passwordConfirm !== body.password) {
      throw new HttpErr(400, 'Validation failed.', { passwordConfirm: { message: '两次输入的密码不一致' } })
    }
    await q(`update users set password_hash = $1, updated = now() where id = $2`, [
      bcrypt.hashSync(String(body.password), 10),
      id,
    ])
  }

  const data = bodyToCols(table, body)
  if (data.size) {
    const sets = []
    const values = []
    for (const [c, v] of data) {
      values.push(castParam(cols.get(c), v))
      sets.push(`"${c}" = $${values.length}`)
    }
    values.push(id)
    await q(`update "${table}" set ${sets.join(', ')}, updated = now() where id = $${values.length}`, values)
  }
  const after = await q(`select * from "${table}" where id = $1`, [id])
  return toRecord(table, after.rows[0])
}

async function handleDelete(table, id, auth) {
  const r = await q(`select * from "${table}" where id = $1`, [id])
  if (!r.rows[0]) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  if (!allowRow(RULES[table].delete, r.rows[0], auth)) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  await q(`delete from "${table}" where id = $1`, [id])
  return null // 204
}

async function handleAuthWithPassword(body) {
  const identity = String(body?.identity ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')
  const r = await q(`select * from users where lower(email) = $1`, [identity])
  const user = r.rows[0]
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    throw new HttpErr(400, 'Failed to authenticate.')
  }
  const token = signToken({
    id: user.id,
    type: 'auth',
    collectionId: colIdOf('users'),
    collectionName: 'users',
    refreshable: true,
    exp: Math.floor(Date.now() / 1000) + 14 * 86400,
  })
  return { token, record: toRecord('users', user) }
}

async function handleAuthRefresh(auth) {
  needAuth(auth)
  const r = await q(`select * from users where id = $1`, [auth.id])
  if (!r.rows[0]) throw new HttpErr(400, 'Failed to authenticate.')
  const token = signToken({
    id: auth.id,
    type: 'auth',
    collectionId: colIdOf('users'),
    collectionName: 'users',
    refreshable: true,
    exp: Math.floor(Date.now() / 1000) + 14 * 86400,
  })
  return { token, record: toRecord('users', r.rows[0]) }
}

// ---------- HTTP 层 ----------

function send(res, status, body) {
  const payload = body === null ? null : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Pb-Auth',
    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
  })
  res.end(payload ?? '')
}

function errBody(e) {
  return { message: e.message || 'Something went wrong.', code: e.status ?? 500, data: e.data ?? {} }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 25e6) throw new HttpErr(413, 'Request entity too large.')
    chunks.push(c)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString())
  } catch {
    throw new HttpErr(400, 'Invalid request body.')
  }
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now()
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  try {
    if (req.method === 'OPTIONS') return send(res, 204, null)

    if (path === '/api/health' || path === '/api/health/') {
      return send(res, 200, { code: 200, message: 'API is healthy.', data: {} })
    }

    const auth = await resolveAuth(req)

    // 认证接口
    let m = path.match(/^\/api\/collections\/users\/auth-with-password\/?$/)
    if (m && req.method === 'POST') {
      const out = await handleAuthWithPassword(await readBody(req))
      return send(res, 200, out)
    }
    m = path.match(/^\/api\/collections\/users\/auth-refresh\/?$/)
    if (m && req.method === 'POST') {
      const out = await handleAuthRefresh(auth)
      return send(res, 200, out)
    }

    // 记录接口
    m = path.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?\/?$/)
    if (m) {
      const table = decodeURIComponent(m[1])
      const id = m[2] ? decodeURIComponent(m[2]) : null
      if (!COLUMNS.has(table) || table === 'gateway_meta') {
        throw new HttpErr(404, 'The requested resource wasn\'t found.')
      }
      if (!id && req.method === 'GET') return send(res, 200, await handleList(table, url, req, auth))
      if (id && req.method === 'GET') return send(res, 200, await handleViewOne(table, id, auth))
      if (!id && req.method === 'POST') return send(res, 200, await handleCreate(table, await readBody(req), auth))
      if (id && (req.method === 'PATCH' || req.method === 'PUT')) {
        return send(res, 200, await handleUpdate(table, id, await readBody(req), auth))
      }
      if (id && req.method === 'DELETE') {
        await handleDelete(table, id, auth)
        return send(res, 204, null)
      }
    }

    throw new HttpErr(404, 'The requested resource wasn\'t found.')
  } catch (e) {
    const status = e instanceof HttpErr ? e.status : 500
    if (status >= 500) console.error(`${req.method} ${path} -> 500:`, e.message)
    send(res, status, errBody(e instanceof HttpErr ? e : new HttpErr(500, 'Internal server error.')))
  } finally {
    const ms = Date.now() - t0
    if (ms > 800) console.warn(`slow: ${req.method} ${path} ${ms}ms`)
  }
})

async function main() {
  await loadColumns()
  await loadSecret()
  const tables = [...COLUMNS.keys()].filter((t) => RULES[t])
  console.log(`Neon 网关就绪：${tables.length} 张业务表，端口 ${PORT}`)
  server.listen(PORT, '0.0.0.0')
}

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000)
})

main().catch((e) => {
  console.error('启动失败:', e.message)
  process.exit(1)
})
