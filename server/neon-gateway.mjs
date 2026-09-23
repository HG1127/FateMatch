// Neon 直连数据网关：在容器 7000 端口提供与原数据服务完全一致的 REST 接口，
// 底层存储换成 Neon(Postgres)。前端与外部代理零改动。
//
// 启动（密钥只走环境变量，不落盘不进仓库）：
//   NEON_DSN='postgresql://…?sslmode=require' node server/neon-gateway.mjs
// 可选：PORT（默认 7000）、NEON_SCHEMA（默认 public，测试用隔离 schema）。
//
// 实现的接口语义与权限规则 1:1 复刻自原数据服务（规则快照见 docs/09），
// 包括：公开表全量可读、私有表按属主过滤、管理员表仅管理员可见。
// 入参校验用 zod 代码化（注册 / 登录 / 改密）。
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const PORT = Number(process.env.PORT ?? 7000)
const SCHEMA = process.env.NEON_SCHEMA ?? 'public'
const DSN = process.env.NEON_DSN
if (!DSN) {
  console.error('缺少 NEON_DSN 环境变量')
  process.exit(1)
}

/** schema 限定的表引用 */
const tq = (name) => `"${SCHEMA}"."${name}"`

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

// ---------- 入参校验（zod） ----------

const AuthBody = z.object({
  identity: z.string().trim().min(3, '请输入邮箱').max(320, '邮箱过长'),
  password: z.string().min(1, '请输入密码').max(200, '密码过长'),
})

const RegisterBody = z.object({
  email: z.string().trim().min(3, '请输入邮箱').max(320, '邮箱过长'),
  password: z.string().min(8, '密码至少 8 位').max(200, '密码过长'),
  passwordConfirm: z.string().min(8, '密码至少 8 位').max(200, '密码过长'),
  name: z.string().max(60, '昵称过长').optional(),
})

const PasswordChangeBody = z.object({
  oldPassword: z.string().min(1, '请输入旧密码').max(200, '密码过长'),
  password: z.string().min(8, '密码至少 8 位').max(200, '密码过长'),
  passwordConfirm: z.string().min(8, '密码至少 8 位').max(200, '密码过长'),
})

/** 校验失败抛 PB 风格的 400（字段级 message） */
function vparse(schema, body) {
  const r = schema.safeParse(body)
  if (r.success) return r.data
  const data = {}
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? 'form')
    data[key] ??= { message: issue.message }
  }
  throw new HttpErr(400, 'Validation failed.', data)
}

// ---------- 表结构元数据 ----------

/** table -> Map(column -> data_type) */
const COLUMNS = new Map()

async function loadColumns() {
  await q(`create schema if not exists "${SCHEMA}"`)
  const r = await q(
    `select table_name, column_name, data_type from information_schema.columns where table_schema = $1`,
    [SCHEMA],
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

// v1.1 计数拆分：内嵌名单列已迁移到 content_likes / event_attendees，
// 旧列读侧屏蔽（防陈旧数据误导），写侧屏蔽（新表是唯一数据源）。
// digests.views 只允许经浏览计数端点原子自增，不接受整行覆写。
const READ_BLOCKED = { posts: ['likes'], post_comments: ['likes'], event_comments: ['likes'], events: ['attendees'] }
const WRITE_BLOCKED = { posts: ['likes'], post_comments: ['likes'], event_comments: ['likes'], events: ['attendees'], digests: ['views'] }
// 仅掌柜可写的敏感字段：防止成员改自己的资料行自我提权 / 自我解封
const ADMIN_ONLY_FIELDS = { profiles: ['role', 'banned'] }

// v1.3 输入尺寸护栏：字段级文本长度 / 数组数量上限（服务端为准，界面 maxLength 与之配套）。
// 超限返回 PB 风格字段级 400，防止异常客户端写入超大内容拖垮全量同步。
const TEXT_LIMITS = {
  posts: { text: 5000, topic: 30 },
  post_comments: { text: 1000 },
  event_comments: { text: 1000 },
  chat_messages: { text: 2000 },
  profiles: { nickname: 30, bio: 500, job: 50, city: 30, region: 30 },
  events: { title: 60, desc: 5000, requirements: 1000, city: 30, region: 30, host: 60 },
  contacts: { text: 200 },
  reports: { reason: 100, note: 1000 },
  digests: { title: 40, intro: 300 },
}
const ARRAY_LIMITS = {
  posts: { images: 9 },
  events: { images: 9, tags: 6 },
  profiles: { photos: 9, interests: 17 },
  chat_messages: { images: 9 },
  digests: { post_sids: 50, covers: 9 },
}

// ---------- 权限规则（与原数据服务逐条一致） ----------

const A = 'auth' // 任意登录用户
const ADMIN = 'admin' // 仅管理员
const SELF = 'self' // 仅本人（users.id）
const OPEN = 'open' // 公开
const DENY = 'deny'
const me = (f) => ({ f }) // 字段 = 当前用户 id

/**
 * 活动留言的写规则（函数规则，支持跨表判定）：
 * 作者本人 / 掌柜 / 所属活动的发起人（发起人在界面上可置顶、删除自己活动下的留言）。
 */
async function eventCommentWrite(row, auth) {
  if (!auth) return false
  if (auth.role === 'admin') return true
  if (String(row.author_sid ?? '') === auth.id) return true
  const ev = await q(`select creator_sid from ${tq('events')} where sid = $1 limit 1`, [row.event_sid])
  return !!ev.rows[0] && String(ev.rows[0].creator_sid ?? '') === auth.id
}

/**
 * 「本人 + 所属活动发起人 + 掌柜」的跨表读规则（checkins / contacts，v1.2 收紧）：
 * 名片含联系方式、签到含行踪，此前任意登录成员可读全表；
 * 现在仅本人行 + 自己发起的活动下的行 + 掌柜可见（与界面展示语义一致）。
 */
const hostOrSelfRead = (f) => async (row, auth) => {
  if (!auth) return false
  if (auth.role === 'admin') return true
  if (String(row[f] ?? '') === auth.id) return true
  const ev = await q(`select creator_sid from ${tq('events')} where sid = $1 limit 1`, [row.event_sid])
  return !!ev.rows[0] && String(ev.rows[0].creator_sid ?? '') === auth.id
}

/** 列表范围的跨表变体：本人行 + 自己发起的活动下的行（掌柜不加限制） */
const HOSTED = 'hosted'
const HOSTED_FIELD = { checkins: 'owner_sid', contacts: 'user_sid' }

/**
 * 拉黑语义的服务端强制（v1.6，此前只有客户端过滤，直连接口可绕过）：
 * 任一方拉黑另一方后，私信与心动都被拒绝；掌柜处置回音不受限。
 */
async function assertNoBlock(a, b, auth, msg) {
  if (!a || !b || a === b) return
  if (auth?.role === 'admin') return
  const r = await q(
    `select 1 from ${tq('blocks')} where (owner_sid = $1 and target_sid = $2) or (owner_sid = $2 and target_sid = $1) limit 1`,
    [a, b],
  )
  if (r.rows[0]) throw new HttpErr(403, msg)
}

const CREATE_HOOKS = {
  chat_messages: (data, auth) =>
    assertNoBlock(String(data.get('sid_a') ?? ''), String(data.get('sid_b') ?? ''), auth, '消息已发出，但被对方拒收了'),
  user_likes: (data, auth) =>
    assertNoBlock(String(data.get('owner_sid') ?? ''), String(data.get('target_sid') ?? ''), auth, '对方已将你加入黑名单，无法互动'),
}

const RULES = {
  users: { list: SELF, view: SELF, create: OPEN, update: SELF, delete: SELF },
  profiles: { list: OPEN, view: OPEN, create: [me('sid'), ADMIN], update: [me('sid'), ADMIN], delete: ADMIN },
  posts: { list: OPEN, view: OPEN, create: [me('author_sid'), ADMIN], update: [me('author_sid'), ADMIN], delete: ADMIN },
  post_comments: { list: OPEN, view: OPEN, create: [me('author_sid'), ADMIN], update: [me('author_sid'), ADMIN], delete: [me('author_sid'), ADMIN] },
  events: { list: OPEN, view: OPEN, create: [me('creator_sid'), ADMIN], update: [me('creator_sid'), ADMIN], delete: [me('creator_sid'), ADMIN] },
  event_comments: { list: OPEN, view: OPEN, create: [me('author_sid'), ADMIN], update: eventCommentWrite, delete: eventCommentWrite },
  chat_messages: { list: [me('sid_a'), me('sid_b'), ADMIN], view: [me('sid_a'), me('sid_b'), ADMIN], create: [me('sid_a'), me('sid_b'), ADMIN], update: [me('sid_a'), me('sid_b'), ADMIN], delete: [me('from_sid'), ADMIN] },
  user_likes: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  user_passes: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  user_reads: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  favorites: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  fav_groups: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  visits: { list: [me('viewer_sid'), me('viewed_sid'), ADMIN], view: [me('viewer_sid'), me('viewed_sid'), ADMIN], create: [me('viewer_sid')], update: [me('viewer_sid')], delete: [me('viewer_sid'), ADMIN] },
  blocks: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  reminders: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  checkins: { list: HOSTED, view: hostOrSelfRead('owner_sid'), create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  contacts: { list: HOSTED, view: hostOrSelfRead('user_sid'), create: [me('user_sid')], update: [me('user_sid')], delete: [me('user_sid'), ADMIN] },
  reports: { list: [me('by_sid'), ADMIN], view: [me('by_sid'), ADMIN], create: [me('by_sid')], update: A, delete: ADMIN },
  digests: { list: OPEN, view: OPEN, create: ADMIN, update: ADMIN, delete: ADMIN },
  content_likes: { list: OPEN, view: OPEN, create: [me('owner_sid')], update: DENY, delete: [me('owner_sid'), ADMIN] },
  event_attendees: { list: OPEN, view: OPEN, create: [me('owner_sid')], update: DENY, delete: [me('owner_sid'), ADMIN] },
  admin_logs: { list: ADMIN, view: ADMIN, create: ADMIN, update: ADMIN, delete: ADMIN },
  site_settings: { list: OPEN, view: OPEN, create: ADMIN, update: ADMIN, delete: DENY },
  user_tour: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
}

// ---------- JWT（HS256，密钥存 Neon gateway_meta，重启不掉登录态） ----------

const b64u = (b) => Buffer.from(b).toString('base64url')

let JWT_SECRET = ''

async function loadSecret() {
  await q(`create table if not exists ${tq('gateway_meta')} (key text primary key, value text not null)`)
  const gen = crypto.randomBytes(32).toString('hex')
  await q(`insert into ${tq('gateway_meta')} (key, value) values ('jwt_secret', $1) on conflict (key) do nothing`, [gen])
  const r = await q(`select value from ${tq('gateway_meta')} where key = 'jwt_secret'`)
  JWT_SECRET = r.rows[0].value
}

function signToken(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

/**
 * 密码指纹（v1.8）：HMAC(会话密钥, 密码哈希) 前 12 位，随令牌下发。
 * 改密 / 掌柜重置后指纹即变，旧令牌全部失效；HMAC 形式不暴露哈希本体。
 */
const pwFingerprint = (hash) =>
  crypto.createHmac('sha256', JWT_SECRET).update(String(hash ?? '')).digest('hex').slice(0, 12)

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

// ---------- v1.4 限流与防爆破（内存固定窗口；单进程语义，重启清零，接公网/多实例前需升级共享态） ----------

const RATE_BUCKETS = new Map() // key -> { n, resetAt }

/** 窗口内计数 +1；未超限返回 true，超限返回 false */
function rateHit(key, limit, windowMs) {
  const now = Date.now()
  let b = RATE_BUCKETS.get(key)
  if (!b || b.resetAt <= now) {
    b = { n: 0, resetAt: now + windowMs }
    RATE_BUCKETS.set(key, b)
  }
  b.n += 1
  return b.n <= limit
}

/** 超限即记日志并抛 429（安全审计：限流命中留痕） */
function rateGate(key, limit, windowMs, msg) {
  if (!rateHit(key, limit, windowMs)) {
    METRICS.rateLimitHits += 1
    console.warn(`rate-limit: ${key}`)
    throw new HttpErr(429, msg)
  }
}

// 定期清理过期窗口，防 Map 无界增长
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of RATE_BUCKETS) if (b.resetAt <= now) RATE_BUCKETS.delete(k)
}, 10 * 60 * 1000).unref()

/** 客户端 IP：优先取代理转发的第一跳 */
const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'

// 登录防爆破：同一邮箱连续错 8 次锁 15 分钟；锁定期在密码校验之前判定（正确密码也拒）
const AUTH_FAILS = new Map() // identity -> { n, lockUntil }
const AUTH_FAIL_LIMIT = 8
const AUTH_LOCK_MS = 15 * 60 * 1000

// ---------- v1.9 运行指标（内存计数，重启清零；仅掌柜可读，不含任何业务数据） ----------
const METRICS = {
  startedAt: Date.now(),
  requests: 0, // 不含健康检查
  byStatus: { '2xx': 0, '4xx': 0, '5xx': 0 },
  latencyTotalMs: 0,
  slowRequests: 0,
  rateLimitHits: 0,
  authFails: 0,
  authLocks: 0,
  authLockedRejects: 0,
  oversizeBodies: 0,
  uploads: { count: 0, bytes: 0 },
  accountCascades: 0,
  passwordResets: 0,
}

function assertNotLocked(identity, ip) {
  const rec = AUTH_FAILS.get(identity)
  if (rec && rec.lockUntil > Date.now()) {
    METRICS.authLockedRejects += 1
    const mins = Math.ceil((rec.lockUntil - Date.now()) / 60000)
    console.warn(`auth-locked-reject: ${identity} ip=${ip}`)
    throw new HttpErr(429, `密码错误次数过多，请 ${mins} 分钟后再试`)
  }
}

function noteAuthFail(identity, ip) {
  const rec = AUTH_FAILS.get(identity) ?? { n: 0, lockUntil: 0 }
  rec.n += 1
  METRICS.authFails += 1
  if (rec.n >= AUTH_FAIL_LIMIT) {
    rec.lockUntil = Date.now() + AUTH_LOCK_MS
    rec.n = 0
    METRICS.authLocks += 1
    console.warn(`auth-lock: ${identity} ip=${ip} 锁定 ${AUTH_LOCK_MS / 60000} 分钟`)
  } else {
    console.warn(`auth-fail: ${identity} ip=${ip} n=${rec.n}`)
  }
  AUTH_FAILS.set(identity, rec)
  if (AUTH_FAILS.size > 1000) {
    // 顺手清扫已过期的锁定记录，防止长期运行无界增长
    const now = Date.now()
    for (const [k, v] of AUTH_FAILS) if (v.n === 0 && v.lockUntil <= now) AUTH_FAILS.delete(k)
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
    if (READ_BLOCKED[table]?.includes(col)) continue
    const out = OUT_ALIAS[table]?.[col] ?? col
    rec[out] = row[col] ?? null
  }
  rec.created = fmtDate(row.created)
  rec.updated = fmtDate(row.updated)
  return rec
}

/** 请求体字段 -> DB 列（未知字段、已拆分旧列、非掌柜写敏感字段一律忽略；超尺寸字段拒绝） */
function bodyToCols(table, body, auth) {
  const cols = COLUMNS.get(table)
  if (!cols) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  const out = new Map()
  for (const [k, v] of Object.entries(body ?? {})) {
    if (['id', 'created', 'updated', 'passwordConfirm', 'oldPassword'].includes(k)) continue
    const col = IN_ALIAS[table]?.[k] ?? k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
    if (!cols.has(col) || HIDDEN.has(col)) continue
    if (WRITE_BLOCKED[table]?.includes(col)) continue
    if (auth?.role !== 'admin' && ADMIN_ONLY_FIELDS[table]?.includes(col)) continue
    // 尺寸护栏：文本按字符数、数组按元素数（图片 dataURL 只限张数，字节数由 25MB 请求体上限兜底）
    const tl = TEXT_LIMITS[table]?.[col]
    if (tl != null && typeof v === 'string' && [...v].length > tl) {
      throw new HttpErr(400, 'Validation failed.', { [k]: { message: `内容过长（上限 ${tl} 字）` } })
    }
    const al = ARRAY_LIMITS[table]?.[col]
    if (al != null && Array.isArray(v) && v.length > al) {
      throw new HttpErr(400, 'Validation failed.', { [k]: { message: `数量超限（上限 ${al} 个）` } })
    }
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

/** 当前请求的登录态：{ id, role } 或 null（停用即拒 v1.6；改密后旧令牌失效、注销账号令牌作废 v1.8） */
async function resolveAuth(req) {
  const raw = req.headers['authorization'] || req.headers['x-pb-auth'] || ''
  const token = String(raw).replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload?.id) return null
  const r = await q(
    `select u.password_hash, p.role, p.banned
     from ${tq('users')} u left join ${tq('profiles')} p on p.sid = u.id
     where u.id = $1 limit 1`,
    [payload.id],
  )
  if (!r.rows[0]) return null // 账号已注销：令牌作废，按匿名处理
  if (r.rows[0].banned) throw new HttpErr(403, '账号已停用，如有疑问请联系掌柜')
  // 密码指纹校验：v1.8 前的旧令牌无 pv 字段，过渡期放行（≤14 天自然到期）
  if (payload.pv && payload.pv !== pwFingerprint(r.rows[0].password_hash)) {
    throw new HttpErr(401, '密码已变更，请重新登录')
  }
  return { id: payload.id, role: r.rows[0].role === 'admin' ? 'admin' : undefined }
}

function needAuth(auth) {
  if (!auth) throw new HttpErr(403, 'You are not allowed to perform this operation.')
  return auth
}

/** 行级规则判定（支持声明式规则与异步函数规则） */
async function allowRow(rule, row, auth) {
  if (typeof rule === 'function') return !!auth && !!(await rule(row, auth))
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

/** 列表范围 -> WHERE 子句（HOSTED 需表名以定位属主字段） */
function scopeWhere(rule, auth, table) {
  if (rule === OPEN) return null
  if (rule === A) { needAuth(auth); return null }
  if (rule === SELF) { needAuth(auth); return { sql: 'id = $1', params: [auth.id] } }
  if (rule === ADMIN) {
    needAuth(auth)
    if (auth.role === 'admin') return null
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  if (rule === HOSTED) {
    needAuth(auth)
    if (auth.role === 'admin') return null
    const f = HOSTED_FIELD[table] ?? 'owner_sid'
    // 本人行 + 自己发起的活动下的行（子查询与主表同 schema）
    return {
      sql: `("${f}" = $1 or "event_sid" in (select "sid" from ${tq('events')} where "creator_sid" = $1))`,
      params: [auth.id],
    }
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
  const scope = scopeWhere(RULES[table].list, auth, table)
  const where = scope ? `where ${scope.sql}` : ''
  const params = scope ? [...scope.params] : []
  const cnt = await q(`select count(*)::int n from ${tq(table)} ${where}`, params)
  const totalItems = cnt.rows[0].n
  const r = await q(
    `select * from ${tq(table)} ${where} order by created asc, id asc limit $${params.length + 1} offset $${params.length + 2}`,
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
  const r = await q(`select * from ${tq(table)} where id = $1`, [id])
  if (!r.rows[0]) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  if (!(await allowRow(RULES[table].view, r.rows[0], auth))) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  return toRecord(table, r.rows[0])
}

async function handleCreate(table, body, auth) {
  if (!allowCreate(RULES[table].create, body ?? {}, auth)) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  const cols = COLUMNS.get(table)
  const data = bodyToCols(table, body, auth)
  // 建行业务钩子（如拉黑拦截），先于入库
  const hook = CREATE_HOOKS[table]
  if (hook) await hook(data, auth)
  const id = typeof body?.id === 'string' && body.id ? body.id : genId()

  if (table === 'users') {
    // 注册：zod 校验 + 邮箱唯一 + 密码哈希
    const parsed = vparse(RegisterBody, body)
    const email = parsed.email.toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpErr(400, 'Validation failed.', { email: { message: '邮箱格式不正确' } })
    }
    if (parsed.passwordConfirm !== parsed.password) {
      throw new HttpErr(400, 'Validation failed.', { passwordConfirm: { message: '两次输入的密码不一致' } })
    }
    const dup = await q(`select 1 from ${tq('users')} where lower(email) = $1`, [email])
    if (dup.rows[0]) {
      throw new HttpErr(400, 'Validation failed.', { email: { message: '该邮箱已注册' } })
    }
    const hash = bcrypt.hashSync(parsed.password, 10)
    try {
      await q(
        `insert into ${tq('users')} (id, email, password_hash, name, avatar, email_visibility, verified, created, updated)
         values ($1,$2,$3,$4,$5,false,false,now(),now())`,
        [id, email, hash, String(parsed.name ?? ''), ''],
      )
    } catch (e) {
      // 大小写变体并发注册撞 lower(email) 唯一索引：转成与查重一致的字段级 400
      if (e?.code === '23505') {
        throw new HttpErr(400, 'Validation failed.', { email: { message: '该邮箱已注册' } })
      }
      throw e
    }
  } else if (table === 'event_attendees') {
    // v1.2 满员校验：锁活动行后在同一事务内数人数并插入，
    // 直连接口并发抢最后一个名额时也不会超员（此前校验只在客户端）。
    const names = ['id', ...data.keys()]
    const values = [id, ...[...data.entries()].map(([c, v]) => castParam(cols.get(c), v))]
    const ph = names.map((_, i) => `$${i + 1}`)
    const quoted = names.map((n) => `"${n}"`)
    const client = await pool.connect()
    try {
      await client.query('begin')
      const evSid = String(data.get('event_sid') ?? '')
      const ev = await client.query(`select capacity from ${tq('events')} where sid = $1 limit 1 for update`, [evSid])
      const cap = Number(ev.rows[0]?.capacity ?? 0)
      if (cap > 0) {
        const cnt = await client.query(
          `select count(*)::int n from ${tq('event_attendees')} where event_sid = $1 and owner_sid <> $2`,
          [evSid, String(data.get('owner_sid') ?? '')],
        )
        if (cnt.rows[0].n >= cap) {
          await client.query('rollback')
          throw new HttpErr(400, 'Validation failed.', { capacity: { message: '活动已满员' } })
        }
      }
      try {
        await client.query(
          `insert into ${tq(table)} (${quoted.join(',')}, created, updated) values (${ph.join(',')}, now(), now())`,
          values,
        )
      } catch (e) {
        // 多端并发重复报名同一行：幂等返回已存在记录
        if (e?.code === '23505' && data.has('sid')) {
          await client.query('rollback')
          const ex = await q(`select * from ${tq(table)} where sid = $1`, [data.get('sid')])
          if (ex.rows[0]) return toRecord(table, ex.rows[0])
        }
        throw e
      }
      await client.query('commit')
    } catch (e) {
      try { await client.query('rollback') } catch { /* 已回滚或连接断开 */ }
      throw e
    } finally {
      client.release()
    }
  } else {
    const names = ['id', ...data.keys()]
    const values = [id, ...[...data.entries()].map(([c, v]) => castParam(cols.get(c), v))]
    const ph = names.map((_, i) => `$${i + 1}`)
    const quoted = names.map((n) => `"${n}"`)
    try {
      await q(
        `insert into ${tq(table)} (${quoted.join(',')}, created, updated) values (${ph.join(',')}, now(), now())`,
        values,
      )
    } catch (e) {
      // sid 撞唯一索引：全量同步架构下多端并发重复建同一行，幂等返回已存在的记录
      if (e?.code === '23505' && data.has('sid')) {
        const ex = await q(`select * from ${tq(table)} where sid = $1`, [data.get('sid')])
        if (ex.rows[0]) return toRecord(table, ex.rows[0])
      }
      throw e
    }
  }
  const r = await q(`select * from ${tq(table)} where id = $1`, [id])
  return toRecord(table, r.rows[0])
}

async function handleUpdate(table, id, body, auth) {
  const r = await q(`select * from ${tq(table)} where id = $1`, [id])
  if (!r.rows[0]) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  const existing = r.rows[0]
  if (!(await allowRow(RULES[table].update, existing, auth))) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  const cols = COLUMNS.get(table)

  if (table === 'users' && body?.password) {
    // 改密码：zod 校验 + 旧密码验证 + 两次新密码一致
    const parsed = vparse(PasswordChangeBody, body)
    if (parsed.passwordConfirm !== parsed.password) {
      throw new HttpErr(400, 'Validation failed.', { passwordConfirm: { message: '两次输入的密码不一致' } })
    }
    const oldOk = bcrypt.compareSync(parsed.oldPassword, existing.password_hash ?? '')
    if (!oldOk) throw new HttpErr(400, 'Validation failed.', { oldPassword: { message: '旧密码不正确' } })
    await q(`update ${tq('users')} set password_hash = $1, updated = now() where id = $2`, [
      bcrypt.hashSync(parsed.password, 10),
      id,
    ])
  }

  const data = bodyToCols(table, body, auth)
  if (data.size) {
    const sets = []
    const values = []
    for (const [c, v] of data) {
      values.push(castParam(cols.get(c), v))
      sets.push(`"${c}" = $${values.length}`)
    }
    values.push(id)
    await q(`update ${tq(table)} set ${sets.join(', ')}, updated = now() where id = $${values.length}`, values)
  }
  const after = await q(`select * from ${tq(table)} where id = $1`, [id])
  return toRecord(table, after.rows[0])
}

async function handleDelete(table, id, auth) {
  const r = await q(`select * from ${tq(table)} where id = $1`, [id])
  if (!r.rows[0]) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  if (!(await allowRow(RULES[table].delete, r.rows[0], auth))) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  if (table === 'users') {
    await cascadeUserDelete(id)
    return null // 204
  }
  await q(`delete from ${tq(table)} where id = $1`, [id])
  return null // 204
}

/**
 * 注销级联（v1.8）：删号即在同一事务内清理本人资料与内容，公开目录不再残留「幽灵会员」。
 * 他人拥有的行（对方侧的会话消息、他人对我的点赞 / 拉黑等）保留，界面按「已注销会员」渲染。
 */
async function cascadeUserDelete(id) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const sids = async (table, field) =>
      (await client.query(`select sid from ${tq(table)} where "${field}" = $1`, [id])).rows.map((x) => x.sid)
    const postSids = await sids('posts', 'author_sid')
    const pcSids = await sids('post_comments', 'author_sid')
    const evSids = await sids('events', 'creator_sid')
    const ecSids = await sids('event_comments', 'author_sid')
    // 点赞：我点出的 + 落在我内容上的
    await client.query(`delete from ${tq('content_likes')} where owner_sid = $1 or target_sid = any($2::text[])`, [id, [...postSids, ...pcSids, ...ecSids]])
    // 我发起的活动及其附属数据（报名 / 签到 / 名片 / 留言）
    await client.query(`delete from ${tq('event_attendees')} where owner_sid = $1 or event_sid = any($2::text[])`, [id, evSids])
    await client.query(`delete from ${tq('checkins')} where owner_sid = $1 or event_sid = any($2::text[])`, [id, evSids])
    await client.query(`delete from ${tq('contacts')} where user_sid = $1 or event_sid = any($2::text[])`, [id, evSids])
    await client.query(`delete from ${tq('event_comments')} where author_sid = $1 or event_sid = any($2::text[])`, [id, evSids])
    await client.query(`delete from ${tq('events')} where creator_sid = $1`, [id])
    // 我的动态及其下的评论（含他人写在我帖子下的）
    await client.query(`delete from ${tq('post_comments')} where author_sid = $1 or post_sid = any($2::text[])`, [id, postSids])
    await client.query(`delete from ${tq('posts')} where author_sid = $1`, [id])
    // 私密行：收藏 / 分组 / 拉黑 / 提醒 / 已读 / 跳过 / 心动 / 引导 / 举报 / 我的走访
    for (const [t, f] of [
      ['favorites', 'owner_sid'], ['fav_groups', 'owner_sid'], ['blocks', 'owner_sid'],
      ['reminders', 'owner_sid'], ['user_reads', 'owner_sid'], ['user_passes', 'owner_sid'],
      ['user_likes', 'owner_sid'], ['user_tour', 'owner_sid'], ['reports', 'by_sid'],
      ['visits', 'viewer_sid'],
    ]) {
      await client.query(`delete from ${tq(t)} where "${f}" = $1`, [id])
    }
    await client.query(`delete from ${tq('profiles')} where sid = $1`, [id])
    // chat_messages 保留：会话是双方共有记录，对方侧仍需可读
    await client.query(`delete from ${tq('users')} where id = $1`, [id])
    await client.query('commit')
    METRICS.accountCascades += 1
    console.log(`account-cascade-delete: ${id}`)
  } catch (e) {
    try { await client.query('rollback') } catch { /* 已断开 */ }
    throw e
  } finally {
    client.release()
  }
}

async function handleAuthWithPassword(body, ip) {
  const parsed = vparse(AuthBody, body)
  const identity = parsed.identity.toLowerCase()
  assertNotLocked(identity, ip)
  const r = await q(`select * from ${tq('users')} where lower(email) = $1`, [identity])
  const user = r.rows[0]
  if (!user || !user.password_hash || !bcrypt.compareSync(parsed.password, user.password_hash)) {
    noteAuthFail(identity, ip)
    throw new HttpErr(400, 'Failed to authenticate.')
  }
  // 密码正确但已停用：拒绝登录（v1.6 服务端强制，此前只在客户端过滤）
  const prof = await q(`select banned from ${tq('profiles')} where sid = $1 limit 1`, [user.id])
  if (prof.rows[0]?.banned) throw new HttpErr(403, '账号已停用，如有疑问请联系掌柜')
  AUTH_FAILS.delete(identity)
  const token = signToken({
    id: user.id,
    type: 'auth',
    collectionId: colIdOf('users'),
    collectionName: 'users',
    refreshable: true,
    pv: pwFingerprint(user.password_hash),
    exp: Math.floor(Date.now() / 1000) + 14 * 86400,
  })
  return { token, record: toRecord('users', user) }
}

async function handleAuthRefresh(auth) {
  needAuth(auth)
  const r = await q(`select * from ${tq('users')} where id = $1`, [auth.id])
  if (!r.rows[0]) throw new HttpErr(400, 'Failed to authenticate.')
  const token = signToken({
    id: auth.id,
    type: 'auth',
    collectionId: colIdOf('users'),
    collectionName: 'users',
    refreshable: true,
    pv: pwFingerprint(r.rows[0].password_hash),
    exp: Math.floor(Date.now() / 1000) + 14 * 86400,
  })
  return { token, record: toRecord('users', r.rows[0]) }
}

/** 精选浏览计数：登录成员触发，服务端原子自增（客户端不再整行覆写 views） */
async function handleDigestView(sidOrId, auth) {
  needAuth(auth)
  const r = await q(
    `update ${tq('digests')} set views = coalesce(views, 0) + 1, updated = now()
     where sid = $1 or id = $1 returning *`,
    [sidOrId],
  )
  if (!r.rows[0]) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  return toRecord('digests', r.rows[0])
}

/**
 * 掌柜重置会员密码（v1.6 补齐账号找回路径）：
 * 生成一次性临时密码（去易混淆字符），落库为哈希，明文只在本次响应返回。
 * 服务端日志留痕重置事件（不含明文）；运营日志由前端掌柜侧补记。
 */
async function handleAdminResetPassword(idOrEmail, auth) {
  needAuth(auth)
  if (auth.role !== 'admin') throw new HttpErr(403, 'You are not allowed to perform this operation.')
  const r = await q(`select id, email from ${tq('users')} where id = $1 or lower(email) = lower($1) limit 1`, [idOrEmail])
  const user = r.rows[0]
  if (!user) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  const alpha = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let temp = ''
  for (let i = 0; i < 12; i++) temp += alpha[crypto.randomInt(alpha.length)]
  await q(`update ${tq('users')} set password_hash = $1, updated = now() where id = $2`, [bcrypt.hashSync(temp, 10), user.id])
  METRICS.passwordResets += 1
  console.log(`admin-reset-password: target=${user.id} by=${auth.id}`)
  return { tempPassword: temp }
}

// ---------- v1.8 图片上传（附件落盘，不再以 dataURL 挤占数据库与同步载荷） ----------

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')
const UPLOAD_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }
const UPLOAD_MAX_BYTES = 8e6 // 解码后上限；前端已压缩到最长边 600–900 的 JPEG，正常 <400KB

/** 登录成员上传：dataURL -> 落盘文件，返回不可猜测的访问路径（凭 URL 访问语义） */
async function handleUpload(body, auth) {
  needAuth(auth)
  const data = String(body?.image ?? '')
  const m = data.match(/^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/i)
  const ext = m ? UPLOAD_TYPES[m[1].toLowerCase()] : null
  if (!ext) throw new HttpErr(400, 'Validation failed.', { image: { message: '仅支持 jpeg / png / webp / gif 图片' } })
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64')
  if (!buf.length) throw new HttpErr(400, 'Validation failed.', { image: { message: '图片内容为空' } })
  if (buf.length > UPLOAD_MAX_BYTES) throw new HttpErr(413, '图片过大（上限 8MB）')
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${ext}`
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf)
  METRICS.uploads.count += 1
  METRICS.uploads.bytes += buf.length
  return { url: `/api/uploads/${name}`, bytes: buf.length }
}

/** 读上传文件：文件名只允许本脚本生成的形态，杜绝路径穿越 */
function handleUploadRead(name, res) {
  if (!/^[a-z0-9]+-[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(name)) {
    throw new HttpErr(404, 'The requested resource wasn\'t found.')
  }
  const fp = path.join(UPLOAD_DIR, name)
  if (!fs.existsSync(fp)) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  const type = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(name)]
  const size = fs.statSync(fp).size
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  })
  fs.createReadStream(fp).pipe(res)
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
    if (size > 25e6) {
      METRICS.oversizeBodies += 1
      console.warn(`oversize-body: ${req.url} >${size}B`)
      throw new HttpErr(413, 'Request entity too large.')
    }
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
      // deep=1 时探活数据库连接（运维/监控用），DB 故障会自然落到 500
      if (url.searchParams.get('deep')) {
        await q('select 1')
        return send(res, 200, { code: 200, message: 'API is healthy.', data: { db: 'ok' } })
      }
      return send(res, 200, { code: 200, message: 'API is healthy.', data: {} })
    }

    // 全局限流：单 IP 固定窗口，防脚本刷爆网关（健康检查不计入）
    const ip = clientIp(req)
    rateGate(`g:${ip}`, 1200, 60_000, 'Too Many Requests.')

    const auth = await resolveAuth(req)

    // 认证接口（另加单 IP 尝试频次限制，防爆破的第一道闸；身份级锁定见 handleAuthWithPassword）
    let m = path.match(/^\/api\/collections\/users\/auth-with-password\/?$/)
    if (m && req.method === 'POST') {
      rateGate(`a:${ip}`, 60, 600_000, '尝试次数过多，请稍后再试')
      const out = await handleAuthWithPassword(await readBody(req), ip)
      return send(res, 200, out)
    }
    m = path.match(/^\/api\/collections\/users\/auth-refresh\/?$/)
    if (m && req.method === 'POST') {
      const out = await handleAuthRefresh(auth)
      return send(res, 200, out)
    }

    // 精选浏览计数（原子自增端点）
    m = path.match(/^\/api\/collections\/digests\/records\/([^/]+)\/view\/?$/)
    if (m && req.method === 'POST') {
      const out = await handleDigestView(decodeURIComponent(m[1]), auth)
      return send(res, 200, out)
    }

    // 掌柜重置会员密码（仅 admin，返回一次性临时密码）
    m = path.match(/^\/api\/admin\/users\/([^/]+)\/reset-password\/?$/)
    if (m && req.method === 'POST') {
      const out = await handleAdminResetPassword(decodeURIComponent(m[1]), auth)
      return send(res, 200, out)
    }

    // 图片上传（登录成员）与读取（文件名不可猜测，凭 URL 访问）
    if ((path === '/api/uploads' || path === '/api/uploads/') && req.method === 'POST') {
      return send(res, 200, await handleUpload(await readBody(req), auth))
    }
    m = path.match(/^\/api\/uploads\/([^/]+)$/)
    if (m && req.method === 'GET') {
      handleUploadRead(decodeURIComponent(m[1]), res)
      return
    }

    // 运行指标（仅掌柜；内存计数，重启清零，不含业务数据）
    if ((path === '/api/metrics' || path === '/api/metrics/') && req.method === 'GET') {
      needAuth(auth)
      if (auth.role !== 'admin') throw new HttpErr(403, 'You are not allowed to perform this operation.')
      return send(res, 200, {
        code: 200,
        message: 'ok',
        data: {
          ...METRICS,
          uptimeSec: Math.round((Date.now() - METRICS.startedAt) / 1000),
          avgLatencyMs: METRICS.requests ? Math.round(METRICS.latencyTotalMs / METRICS.requests) : 0,
          tables: [...COLUMNS.keys()].filter((x) => RULES[x]).length,
          heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
        },
      })
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
      if (!id && req.method === 'POST') {
        // 注册限流：单 IP 每小时上限，防批量灌号（预览代理可能全站共享出口 IP，留足真实注册余量）
        if (table === 'users') rateGate(`r:${ip}`, 50, 3_600_000, '注册尝试过多，请稍后再试')
        return send(res, 200, await handleCreate(table, await readBody(req), auth))
      }
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
    if (ms > 800) {
      METRICS.slowRequests += 1
      console.warn(`slow: ${req.method} ${path} ${ms}ms`)
    }
    // 指标计数（健康检查除外，避免看护轮询淹没真实流量）
    if (!path.startsWith('/api/health')) {
      METRICS.requests += 1
      METRICS.latencyTotalMs += ms
      const cls = `${Math.floor(res.statusCode / 100)}xx`
      if (METRICS.byStatus[cls] !== undefined) METRICS.byStatus[cls] += 1
    }
  }
})

async function main() {
  await loadColumns()
  await loadSecret()
  const tables = [...COLUMNS.keys()].filter((t) => RULES[t])
  console.log(`Neon 网关就绪：${tables.length} 张业务表，schema ${SCHEMA}，端口 ${PORT}`)
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
