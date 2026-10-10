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
import { createMessagingHandlers } from './domains/messaging.mjs'
import { createProfileHandlers } from './domains/profiles.mjs'
import { createSafetyHandlers } from './domains/safety.mjs'
import { createMatchingGuards } from './domains/matching.mjs'
import { createAuthHandlers } from './domains/auth.mjs'
import { createEventHandlers } from './domains/events.mjs'
import { createAdminHandlers } from './domains/admin.mjs'
import { createStaticSiteHandler } from './static-site.mjs'
import { createClientIpResolver } from './client-ip.mjs'
import { registerIdlePoolErrorHandler } from './db-pool-health.mjs'
import { mayStoreUpload } from './upload-preview-policy.mjs'

const PORT = Number(process.env.PORT ?? 7000)
const HOST = process.env.HOST ?? '0.0.0.0'
const SERVE_STATIC = process.env.SERVE_STATIC === '1'
let staticSite = null
const SCHEMA = process.env.NEON_SCHEMA ?? 'public'
if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(SCHEMA)) throw new Error('NEON_SCHEMA 无效')
const STAGING_MODE = process.env.STAGING_MODE === '1'
if (STAGING_MODE && (!/^staging_[a-z0-9_]{3,48}$/.test(SCHEMA) || SCHEMA === 'staging_public')) {
  throw new Error('预发布模式只允许 staging_* schema，禁止指向 public')
}
const DSN = process.env.NEON_DSN
const ADMIN_EMAILS = new Set(
  String(process.env.SY_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map(x => x.trim().toLowerCase())
    .filter(Boolean),
)
if (!DSN) {
  console.error('缺少 NEON_DSN 环境变量')
  process.exit(1)
}

/** schema 限定的表引用 */
const tq = (name) => `"${SCHEMA}"."${name}"`

const pool = new pg.Pool({
  connectionString: DSN,
  // 生产环境必须验证 Neon TLS 服务端证书；开发自签名兼容仅留给本机测试。
  ssl: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  max: 5,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 60000,
})
registerIdlePoolErrorHandler(pool)

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
  adultConfirmed: z.boolean().refine(Boolean, '请先确认已满 18 周岁'),
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
  events: { title: 60, desc: 5000, requirements: 1000, city: 30, region: 30, host: 60, venue: 140, cost_note: 300, cancel_note: 500 },
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

// ---------- v1.12 敏感词过滤（只拦公开内容写路径；私信 / 名片 / 举报等私密场景不拦，正常交换联系方式不受影响） ----------

// 内置底线词表（黄赌毒枪与明显广告骚扰）；掌柜可经管理端点追加自定义词（存 gateway_meta，不经公开读接口外露）
const DEFAULT_BLOCKED_WORDS = [
  '博彩', '赌场', '老虎机', '六合彩', '私彩', '裸聊', '色情', '援交', '代孕',
  '枪支', '弹药', '迷药', '听话水', '代开发票', '高利贷', '办证刻章', '上门推销',
]
const WORD_FILTER_FIELDS = {
  posts: ['text', 'topic'],
  post_comments: ['text'],
  event_comments: ['text'],
  events: ['title', 'desc', 'requirements', 'venue', 'cost_note', 'cancel_note'],
  profiles: ['nickname', 'bio'],
}
let extraBlockedWords = [] // 掌柜自定义追加词（内存缓存，启动加载 + 管理端点保存时刷新）

async function loadBlockedWords() {
  try {
    const r = await q(`select value from ${tq('gateway_meta')} where key = 'blocked_words'`)
    const arr = r.rows[0] ? JSON.parse(r.rows[0].value) : []
    extraBlockedWords = Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x) : []
  } catch {
    extraBlockedWords = []
  }
}

/** 命中违规词抛字段级 400（掌柜豁免：处置违规内容时不能被自己拦下） */
function checkBlockedWords(table, col, v, auth, fieldKey) {
  if (auth?.role === 'admin') return
  if (!WORD_FILTER_FIELDS[table]?.includes(col) || typeof v !== 'string') return
  const hay = v.toLowerCase()
  for (const w of [...DEFAULT_BLOCKED_WORDS, ...extraBlockedWords]) {
    if (w && hay.includes(w.toLowerCase())) {
      METRICS.wordBlocked += 1
      console.warn(`word-blocked: ${table}.${col} word=${w} by=${auth?.id ?? 'anon'}`)
      secEvent('word_blocked', { actorSid: auth?.id ?? '', detail: { table, word: w }, dk: `word_blocked:${auth?.id ?? 'anon'}:${w}` })
      throw new HttpErr(400, 'Validation failed.', { [fieldKey]: { message: `内容包含违规词「${w}」，请修改后再提交` } })
    }
  }
}

async function isConfiguredAdminId(userId) {
  if (!userId || !ADMIN_EMAILS.size) return false
  const r = await q(`select lower(email) email from ${tq('users')} where id = $1 limit 1`, [userId])
  return !!r.rows[0]?.email && ADMIN_EMAILS.has(String(r.rows[0].email))
}

/**
 * 显式管理员白名单：只由服务端环境变量控制，不允许前端以“首个账号”猜测管理员。
 * 已存在的 admin 不会因移出白名单自动降权；白名单主要用于首管/运维授予。
 */
async function bootstrapConfiguredAdmins() {
  if (!ADMIN_EMAILS.size || !COLUMNS.has('users') || !COLUMNS.has('profiles')) return 0
  const emails = [...ADMIN_EMAILS]
  const r = await q(
    `update ${tq('profiles')} p
     set role = 'admin', updated = now()
     from ${tq('users')} u
     where p.sid = u.id and lower(u.email) = any($1::text[]) and coalesce(p.role, '') <> 'admin'
     returning p.sid`,
    [emails],
  )
  if (r.rowCount) console.log(`admin-bootstrap: promoted ${r.rowCount} configured account(s)`)
  return r.rowCount ?? 0
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

class HttpErr extends Error {
  constructor(status, message, data = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

const { assertMutualChat, assertLikeAllowed } = createMatchingGuards({ q, tq, HttpErr })

const CREATE_HOOKS = {
  chat_messages: assertMutualChat,
  user_likes: assertLikeAllowed,
}

const RULES = {
  users: { list: SELF, view: SELF, create: OPEN, update: SELF, delete: SELF },
  // 真人业务数据仅登录成员可读；游客首页只使用本地明确标注的演示素材。
  profiles: { list: ADMIN, view: A, create: [me('sid'), ADMIN], update: [me('sid'), ADMIN], delete: ADMIN },
  posts: { list: A, view: A, create: [me('author_sid'), ADMIN], update: [me('author_sid'), ADMIN], delete: ADMIN },
  post_comments: { list: A, view: A, create: [me('author_sid'), ADMIN], update: [me('author_sid'), ADMIN], delete: [me('author_sid'), ADMIN] },
  events: { list: A, view: A, create: [me('creator_sid'), ADMIN], update: [me('creator_sid'), ADMIN], delete: [me('creator_sid'), ADMIN] },
  event_comments: { list: A, view: A, create: [me('author_sid'), ADMIN], update: eventCommentWrite, delete: eventCommentWrite },
  // 私信内容仅会话双方可读写；管理员通过举报/安全事件治理，不直接读取或改写会员私信正文与图片。
  chat_messages: { list: [me('sid_a'), me('sid_b')], view: [me('sid_a'), me('sid_b')], create: [me('from_sid')], update: [me('from_sid')], delete: [me('from_sid')] },
  user_likes: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  user_passes: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  user_reads: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  favorites: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  fav_groups: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  visits: { list: [me('viewer_sid'), me('viewed_sid'), ADMIN], view: [me('viewer_sid'), me('viewed_sid'), ADMIN], create: [me('viewer_sid')], update: [me('viewer_sid')], delete: [me('viewer_sid'), ADMIN] },
  blocks: { list: [me('owner_sid'), me('target_sid'), ADMIN], view: [me('owner_sid'), me('target_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  reminders: { list: [me('owner_sid'), ADMIN], view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: [me('owner_sid')], delete: [me('owner_sid'), ADMIN] },
  // 到场记录只能通过现场核销端点创建，关闭通用集合直写。
  checkins: { list: HOSTED, view: hostOrSelfRead('owner_sid'), create: DENY, update: DENY, delete: [me('owner_sid'), ADMIN] },
  contacts: { list: HOSTED, view: hostOrSelfRead('user_sid'), create: [me('user_sid')], update: [me('user_sid')], delete: [me('user_sid'), ADMIN] },
  reports: { list: [me('by_sid'), ADMIN], view: [me('by_sid'), ADMIN], create: [me('by_sid')], update: ADMIN, delete: ADMIN },
  digests: { list: A, view: A, create: ADMIN, update: ADMIN, delete: ADMIN },
  content_likes: { list: A, view: [me('owner_sid'), ADMIN], create: [me('owner_sid')], update: DENY, delete: [me('owner_sid'), ADMIN] },
  event_attendees: { list: A, view: hostOrSelfRead('owner_sid'), create: [me('owner_sid')], update: DENY, delete: [me('owner_sid'), ADMIN] },
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

/** 超限即记日志并抛 429（安全审计：限流命中留痕，文件日志 + 落库双写） */
function rateGate(key, limit, windowMs, msg) {
  if (!rateHit(key, limit, windowMs)) {
    METRICS.rateLimitHits += 1
    console.warn(`rate-limit: ${key}`)
    secEvent('rate_limit', { ip: key.slice(2), detail: { key } })
    throw new HttpErr(429, msg)
  }
}

// 定期清理过期窗口，防 Map 无界增长
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of RATE_BUCKETS) if (b.resetAt <= now) RATE_BUCKETS.delete(k)
}, 10 * 60 * 1000).unref()

// Default: only trust the network socket peer, never a caller-supplied header.
// Reverse proxies may be trusted by explicitly setting TRUSTED_PROXY_IPS.
const clientIp = createClientIpResolver(
  String(process.env.TRUSTED_PROXY_IPS ?? '').split(/[,;\s]+/).filter(Boolean),
)

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
  wordBlocked: 0,
}

// ---------- v1.12 安全事件持久化（security_events 表，仅掌柜经管理端点可查；写失败不影响业务请求） ----------

const SEC_DEDUP = new Map() // type:主体 -> 最近落库时间（同类事件 60 秒内只记一次，防攻击刷屏）
const SEC_RETENTION_MS = 90 * 86400_000 // 留痕保留 90 天，超期自动清理

/** 邮箱等身份标识脱敏后再落库（ad***@x.com），日志可读但不泄露完整身份 */
function maskIdentity(s) {
  const v = String(s ?? '')
  if (!v) return ''
  const at = v.indexOf('@')
  if (at > 0) return `${v.slice(0, Math.min(2, at))}***${v.slice(at)}`
  return `${v.slice(0, 2)}***`
}

/** 落一条安全事件（fire-and-forget：表未建 / 网络抖动时静默跳过，绝不拖垮业务路径）；dk 可覆写去重键 */
function secEvent(type, { actorSid = '', identity = '', ip = '', detail = null, dk = '' } = {}) {
  const dedupKey = dk || `${type}:${identity || actorSid || ip}`
  const now = Date.now()
  if (now - (SEC_DEDUP.get(dedupKey) ?? 0) < 60_000) return
  SEC_DEDUP.set(dedupKey, now)
  q(
    `insert into ${tq('security_events')} (id, "type", actor_sid, identity, ip, detail, "at", created)
     values ($1,$2,$3,$4,$5,$6,$7,now())`,
    [genId(), type, actorSid, maskIdentity(identity), ip, detail ? JSON.stringify(detail) : null, now],
  ).catch(() => {})
}

// 过期窗口与去重记录一并清扫；留痕超期行每 6 小时清一次
setInterval(() => {
  const now = Date.now()
  for (const [k, t] of SEC_DEDUP) if (now - t > 60_000) SEC_DEDUP.delete(k)
  q(`delete from ${tq('security_events')} where "at" < $1`, [now - SEC_RETENTION_MS]).catch(() => {})
}, 6 * 3600_000).unref()

function assertNotLocked(identity, ip) {
  const rec = AUTH_FAILS.get(identity)
  if (rec && rec.lockUntil > Date.now()) {
    METRICS.authLockedRejects += 1
    const mins = Math.ceil((rec.lockUntil - Date.now()) / 60000)
    console.warn(`auth-locked-reject: ${maskIdentity(identity)} ip=${ip}`)
    secEvent('auth_locked_reject', { identity, ip })
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
    console.warn(`auth-lock: ${maskIdentity(identity)} ip=${ip} 锁定 ${AUTH_LOCK_MS / 60000} 分钟`)
    secEvent('auth_lock', { identity, ip, detail: { minutes: AUTH_LOCK_MS / 60000 } })
  } else {
    console.warn(`auth-fail: ${maskIdentity(identity)} ip=${ip} n=${rec.n}`)
    secEvent('auth_fail', { identity, ip, detail: { n: rec.n } })
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

/**
 * 互动计数表对普通会员只暴露计数所需的匿名占位：
 * - 本人自己的行保持真实 owner_sid，客户端才能判断“我已点赞/已报名”；
 * - 活动发起人能看到自己活动的真实报名人；
 * - 其他人的 owner_sid 与带身份信息的业务 sid 同时匿名化，避免从网络响应还原关系图。
 */
async function listRecordsForAuth(table, rows, auth) {
  if (!auth || auth.role === 'admin' || (table !== 'content_likes' && table !== 'event_attendees')) {
    return rows.map((row) => toRecord(table, row))
  }
  let hosted = new Set()
  if (table === 'event_attendees') {
    const r = await q(`select sid from ${tq('events')} where creator_sid = $1`, [auth.id])
    hosted = new Set(r.rows.map((row) => String(row.sid ?? '')))
  }
  return rows.map((row) => {
    const rec = toRecord(table, row)
    const mine = String(row.owner_sid ?? '') === auth.id
    const hostCanSee = table === 'event_attendees' && hosted.has(String(row.event_sid ?? ''))
    if (!mine && !hostCanSee) {
      const anon = `anon:${row.id}`
      rec.sid = anon
      rec.owner_sid = anon
    }
    return rec
  })
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
    // 敏感词拦截（公开内容字段；掌柜豁免）
    checkBlockedWords(table, col, v, auth, k)
    out.set(col, v)
  }
  return out
}

// 更新时不能改写关系/消息归属字段，否则本人可以把自己的记录“改成”他人行为。

/** 业务语义护栏：尺寸正确不代表业务事实有效。 */
function validateBusinessData(table, data, mode = 'write') {
  if (table === 'posts' && mode === 'create') {
    const topic = String(data.get('topic') ?? '')
    if (!['认识我', '兴趣见闻', '活动回顾', '想一起做'].includes(topic)) {
      throw new HttpErr(400, 'Validation failed.', { topic: { message: '请选择有效的内容方向' } })
    }
    return
  }
  if (table !== 'profiles') return
  for (const field of ['gender', 'seeking']) {
    if (!data.has(field)) continue
    const v = String(data.get(field) ?? '')
    if (!['male', 'female', 'unknown'].includes(v)) {
      throw new HttpErr(400, 'Validation failed.', { [field]: { message: '选项无效' } })
    }
  }
  if (data.has('birth_date')) {
    const raw = String(data.get('birth_date') ?? '').trim()
    if (raw) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new HttpErr(400, 'Validation failed.', { birthDate: { message: '出生日期格式不正确' } })
      }
      const d = new Date(`${raw}T00:00:00Z`)
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
        throw new HttpErr(400, 'Validation failed.', { birthDate: { message: '出生日期无效' } })
      }
      const now = new Date()
      let age = now.getUTCFullYear() - d.getUTCFullYear()
      const md = now.getUTCMonth() - d.getUTCMonth()
      if (md < 0 || (md === 0 && now.getUTCDate() < d.getUTCDate())) age--
      if (age < 18) throw new HttpErr(400, 'Validation failed.', { birthDate: { message: '随缘网仅面向 18 周岁以上成年人' } })
      if (age > 120) throw new HttpErr(400, 'Validation failed.', { birthDate: { message: '请检查出生日期' } })
    }
  }
  if (data.has('height')) {
    const h = Number(data.get('height') ?? 0)
    if (!Number.isFinite(h) || (h !== 0 && (h < 140 || h > 220))) {
      throw new HttpErr(400, 'Validation failed.', { height: { message: '身高请填写 140–220 cm，或留空' } })
    }
  }
}

const UPDATE_IMMUTABLE_FIELDS = {
  chat_messages: ['sid', 'sid_a', 'sid_b', 'from_sid', 'at'],
  user_likes: ['sid', 'owner_sid', 'target_sid'],
  user_passes: ['sid', 'owner_sid', 'target_sid'],
  blocks: ['sid', 'owner_sid', 'target_sid'],
}

function castParam(colType, v) {
  if (v === null || v === undefined) return null
  if (colType === 'jsonb') return JSON.stringify(v)
  if (colType === 'boolean') return Boolean(v)
  return v
}

/** 当前请求的登录态：{ id, role } 或 null（停用即拒 v1.6；改密后旧令牌失效、注销账号令牌作废 v1.8） */
async function resolveAuth(req) {
  // 首选标准 Authorization；兼容旧版 X-Pb-Auth，待客户端迁移验收后另行废弃。
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
const authHandlers = createAuthHandlers({
  q,
  tq,
  needAuth,
  HttpErr,
  parseAuthBody: (body) => vparse(AuthBody, body),
  assertNotLocked,
  noteAuthFail,
  clearAuthFail: (identity) => AUTH_FAILS.delete(identity),
  comparePassword: (password, hash) => bcrypt.compareSync(password, hash),
  secEvent,
  signToken,
  pwFingerprint,
  colIdOf,
  toRecord,
})

const { handleChatSummaries, handleChatConversation, handleChatActivity, handleRelationshipFeedback, handleRelationshipFeedbackSet } = createMessagingHandlers({
  q,
  tq,
  needAuth,
  HttpErr,
})

const { handleProfileLookup, handleDiscoveryProfiles, handleMyVisits } = createProfileHandlers({
  q,
  tq,
  needAuth,
  HttpErr,
  toRecord,
})

const safetyHandlers = createSafetyHandlers({
  q,
  tq,
  needAuth,
  needAdmin,
  HttpErr,
  pool,
  toRecord,
  secEvent,
  defaultBlockedWords: DEFAULT_BLOCKED_WORDS,
  getExtraBlockedWords: () => extraBlockedWords,
  setExtraBlockedWords: (words) => { extraBlockedWords = words },
})

const eventHandlers = createEventHandlers({
  q,
  tq,
  needAuth,
  HttpErr,
  toRecord,
  genId,
  getCheckinSecret: () => JWT_SECRET,
})

const adminHandlers = createAdminHandlers({
  q,
  tq,
  needAdmin,
  HttpErr,
  hashPassword: (value) => bcrypt.hashSync(value, 10),
  metrics: METRICS,
  secEvent,
  tableCount: () => [...COLUMNS.keys()].filter((x) => RULES[x]).length,
})

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
    items: await listRecordsForAuth(table, r.rows, auth),
  }
}

/** 社区帖子专用分页：列表只查询当前页帖子及其评论，避免登录时全量拉取社区内容。 */
async function handleCommunityPosts(url, auth) {
  needAuth(auth)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
  const perPage = Math.min(36, Math.max(1, Number(url.searchParams.get('perPage') ?? 18) || 18))
  const topic = String(url.searchParams.get('topic') ?? '').trim().slice(0, 30)
  const keyword = String(url.searchParams.get('q') ?? '').trim().slice(0, 100)
  const sort = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new'
  const localFirst = url.searchParams.get('localFirst') !== '0'
  const ids = String(url.searchParams.get('ids') ?? '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 50)
  const demoPostIds = ['p01','p02','p03','p04','p05','p06','p07','p08','p09','p10','p11']
  const demoAuthorIds = ['u01','u02','u03','u04','u05','u06','u07','u08','u09','u10','u11','u12','adm']

  const meR = await q(`select city from ${tq('profiles')} where sid = $1 limit 1`, [auth.id])
  const myCity = String(meR.rows[0]?.city ?? '')
  const params = [auth.id, demoPostIds, demoAuthorIds]
  const conditions = [
    `not (p.sid = any($2::text[]))`,
    `not (p.author_sid = any($3::text[]))`,
    `coalesce(a.banned, false) = false`,
    `not exists (select 1 from ${tq('blocks')} b where (b.owner_sid = $1 and b.target_sid = p.author_sid) or (b.owner_sid = p.author_sid and b.target_sid = $1))`,
  ]
  if (ids.length) {
    params.push(ids)
    conditions.push(`p.sid = any($${params.length}::text[])`)
  }
  if (topic) {
    params.push(topic)
    conditions.push(`p.topic = $${params.length}`)
  }
  if (keyword) {
    params.push(`%${keyword}%`)
    const n = params.length
    conditions.push(`(p.text ilike $${n} or p.topic ilike $${n} or coalesce(a.nickname, '') ilike $${n})`)
  }
  const where = `where ${conditions.join(' and ')}`
  const cnt = await q(
    `select count(*)::int n from ${tq('posts')} p left join ${tq('profiles')} a on a.sid = p.author_sid ${where}`,
    params,
  )
  const totalItems = Number(cnt.rows[0]?.n ?? 0)
  const order = [
    `coalesce(p.featured, false) desc`,
    localFirst && myCity ? `(a.city = $${params.length + 1}) desc` : null,
    sort === 'hot' ? `coalesce(l.cnt, 0) desc` : null,
    `p.at desc`,
    `p.id asc`,
  ].filter(Boolean).join(', ')
  const listParams = [...params]
  if (localFirst && myCity) listParams.push(myCity)
  listParams.push(perPage, (page - 1) * perPage)
  const limitPos = listParams.length - 1
  const offsetPos = listParams.length
  const rows = await q(
    `select p.*, coalesce(l.cnt, 0)::int like_count, coalesce(l.mine, false) liked_by_me
     from ${tq('posts')} p
     left join ${tq('profiles')} a on a.sid = p.author_sid
     left join lateral (
       select count(*)::int cnt, coalesce(bool_or(owner_sid = $1), false) mine
       from ${tq('content_likes')}
       where kind = 'post' and target_sid = p.sid
     ) l on true
     ${where}
     order by ${order}
     limit $${limitPos} offset $${offsetPos}`,
    listParams,
  )

  const postIds = rows.rows.map(row => String(row.sid))
  let comments = []
  if (postIds.length) {
    const cr = await q(
      `select * from ${tq('post_comments')} where post_sid = any($1::text[]) order by at asc, created asc, id asc`,
      [postIds],
    )
    comments = cr.rows
  }
  const commentsBy = new Map()
  for (const c of comments) {
    const k = String(c.post_sid)
    const list = commentsBy.get(k)
    const item = { id: String(c.sid), authorId: String(c.author_sid ?? ''), text: String(c.text ?? ''), at: Number(c.at ?? 0), likes: [] }
    if (list) list.push(item)
    else commentsBy.set(k, [item])
  }

  const items = rows.rows.map(row => {
    const count = Number(row.like_count ?? 0)
    const mine = !!row.liked_by_me
    const likes = []
    if (mine) likes.push(auth.id)
    for (let i = likes.length; i < count; i++) likes.push(`anon:post:${row.id}:${i}`)
    return {
      id: String(row.sid),
      authorId: String(row.author_sid ?? ''),
      text: String(row.text ?? ''),
      images: Array.isArray(row.images) ? row.images : [],
      topic: String(row.topic ?? ''),
      featured: !!row.featured,
      likes,
      comments: commentsBy.get(String(row.sid)) ?? [],
      at: Number(row.at ?? 0),
    }
  })

  return {
    page,
    perPage,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
    items,
  }
}

async function handleCommunityDigests(auth) {
  needAuth(auth)
  const r = await q(`select * from ${tq('digests')} order by issue desc, at desc, created desc limit 8`)
  return r.rows.map(row => toRecord('digests', row))
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
  validateBusinessData(table, data, 'create')
  if (table === 'profiles' && auth && await isConfiguredAdminId(auth.id)) data.set('role', 'admin')
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
  } else if (table === 'admin_logs' || table === 'digests') {
    // 管理日志与每周精选在服务端原子执行「写入 + 保留策略」，避免依赖客户端全量同步做裁剪。
    const names = ['id', ...data.keys()]
    const values = [id, ...[...data.entries()].map(([c, v]) => castParam(cols.get(c), v))]
    const ph = names.map((_, i) => `$${i + 1}`)
    const quoted = names.map((n) => `"${n}"`)
    const client = await pool.connect()
    try {
      await client.query('begin')
      try {
        await client.query(
          `insert into ${tq(table)} (${quoted.join(',')}, created, updated) values (${ph.join(',')}, now(), now())`,
          values,
        )
      } catch (e) {
        if (e?.code === '23505' && data.has('sid')) {
          await client.query('rollback')
          const ex = await q(`select * from ${tq(table)} where sid = $1`, [data.get('sid')])
          if (ex.rows[0]) return toRecord(table, ex.rows[0])
        }
        throw e
      }
      if (table === 'admin_logs') {
        await client.query(
          `delete from ${tq('admin_logs')} where id in (select id from ${tq('admin_logs')} order by at desc, created desc offset 100)`,
        )
      } else {
        await client.query(
          `delete from ${tq('digests')} where id in (select id from ${tq('digests')} order by issue desc, at desc, created desc offset 8)`,
        )
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
      // sid 撞唯一索引：可重试命令并发重复建同一行时，幂等返回已存在记录。
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
    secEvent('password_changed', { actorSid: id, identity: existing.email })
  }

  if (table === 'users' && body?.email != null) {
    // 改邮箱（接口级路径，界面只读展示）：格式与唯一性校验对齐注册，并归一化为小写
    const email = String(body.email).trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpErr(400, 'Validation failed.', { email: { message: '邮箱格式不正确' } })
    }
    const dup = await q(`select 1 from ${tq('users')} where lower(email) = $1 and id <> $2`, [email, id])
    if (dup.rows[0]) throw new HttpErr(400, 'Validation failed.', { email: { message: '该邮箱已被使用' } })
    body.email = email
  }

  const data = bodyToCols(table, body, auth)
  for (const col of UPDATE_IMMUTABLE_FIELDS[table] ?? []) data.delete(col)
  if (table === 'chat_messages') {
    const keys = [...data.keys()]
    if (keys.some((k) => k !== 'recalled') || !data.has('recalled') || data.get('recalled') !== true) {
      throw new HttpErr(400, 'Validation failed.', { recalled: { message: '已发送消息只允许执行撤回' } })
    }
    if (!existing.recalled) {
      const sentAt = Number(existing.at ?? 0)
      if (!sentAt || Date.now() - sentAt > 2 * 60_000) {
        throw new HttpErr(400, 'Validation failed.', { recalled: { message: '消息发送超过 2 分钟，无法撤回' } })
      }
    }
  }
  if (table === 'posts' && data.has('topic')) {
    const topic = String(data.get('topic') ?? '')
    const previousTopic = String(existing.topic ?? '')
    const currentTopics = ['认识我', '兴趣见闻', '活动回顾', '想一起做']
    // 历史旧帖可继续原样保存/精选，但不能把任何帖子主动改成旧的泛话题。
    if (!currentTopics.includes(topic) && topic !== previousTopic) {
      throw new HttpErr(400, 'Validation failed.', { topic: { message: '请选择有效的内容方向' } })
    }
  }
  validateBusinessData(table, data, 'update')
  // UPDATE 与返回必须是一个原子 SQL；不可先 UPDATE 再 SELECT，
  // 否则账号并发注销会删掉中间的行并造成 toRecord(undefined) → 500。
  let updatedRow = null
  if (data.size) {
    // 掌柜处置动作落安全事件（停用 / 恢复 / 角色变更），仅在实际发生变化时记录
    if (table === 'profiles' && auth?.role === 'admin') {
      if (data.has('banned') && Boolean(data.get('banned')) !== Boolean(existing.banned)) {
        secEvent(data.get('banned') ? 'ban_set' : 'ban_unset', { actorSid: auth.id, detail: { target: existing.sid } })
      }
      if (data.has('role') && String(data.get('role') ?? '') !== String(existing.role ?? '')) {
        secEvent('role_changed', { actorSid: auth.id, detail: { target: existing.sid, from: existing.role ?? '', to: String(data.get('role') ?? '') } })
      }
    }
    const sets = []
    const values = []
    for (const [c, v] of data) {
      values.push(castParam(cols.get(c), v))
      sets.push(`"${c}" = $${values.length}`)
    }
    values.push(id)
    const updated = await q(`update ${tq(table)} set ${sets.join(', ')}, updated = now() where id = $${values.length} returning *`, values)
    updatedRow = updated.rows[0] ?? null
  } else {
    // 修改密码等特殊更新可能通过独立 SQL 写入，仍须读取最新版本。
    const after = await q(`select * from ${tq(table)} where id = $1`, [id])
    updatedRow = after.rows[0] ?? null
  }
  if (!updatedRow) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  return toRecord(table, updatedRow)
}

async function handleDelete(table, id, auth) {
  const r = await q(`select * from ${tq(table)} where id = $1`, [id])
  if (!r.rows[0]) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  if (!(await allowRow(RULES[table].delete, r.rows[0], auth))) {
    throw new HttpErr(403, 'You are not allowed to perform this operation.')
  }
  if (table === 'users') {
    await cascadeUserDelete(id)
    secEvent('account_deleted', { actorSid: auth?.id ?? id, identity: r.rows[0].email, detail: { target: id, self: auth?.id === id } })
    return null // 204
  }
  if (table === 'posts' || table === 'events') {
    await cascadeContentDelete(table, r.rows[0])
    secEvent('content_deleted', { actorSid: auth?.id ?? '', detail: { table, sid: String(r.rows[0].sid ?? r.rows[0].id) } })
    return null // 204
  }
  if (table === 'post_comments' || table === 'event_comments') {
    await cascadeCommentDelete(table, r.rows[0])
    return null // 204
  }
  await q(`delete from ${tq(table)} where id = $1`, [id])
  return null // 204
}

/** 删除单条评论时同时清掉落在该评论上的点赞，避免孤儿关系。 */
async function cascadeCommentDelete(table, row) {
  const sid = String(row.sid ?? row.id)
  const kind = table === 'post_comments' ? 'post_comment' : 'event_comment'
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`delete from ${tq('content_likes')} where kind = $1 and target_sid = $2`, [kind, sid])
    await client.query(`delete from ${tq(table)} where id = $1`, [row.id])
    await client.query('commit')
  } catch (e) {
    try { await client.query('rollback') } catch { /* 已断开 */ }
    throw e
  } finally {
    client.release()
  }
}

/**
 * 内容删除级联（v1.10）：删帖 / 删活动时在同一事务内清掉其附属行
 * （评论、落在其上的点赞、报名 / 签到 / 名片），不再产生孤儿数据。
 */
async function cascadeContentDelete(table, row) {
  const sid = String(row.sid ?? row.id)
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (table === 'posts') {
      const cs = await client.query(`select sid from ${tq('post_comments')} where post_sid = $1`, [sid])
      const cSids = cs.rows.map((x) => x.sid)
      await client.query(
        `delete from ${tq('content_likes')} where (kind = 'post' and target_sid = $1) or (kind = 'post_comment' and target_sid = any($2::text[]))`,
        [sid, cSids],
      )
      await client.query(`delete from ${tq('post_comments')} where post_sid = $1`, [sid])
      await client.query(`delete from ${tq('favorites')} where fav_type = 'posts' and target_sid = $1`, [sid])
    } else {
      const cs = await client.query(`select sid from ${tq('event_comments')} where event_sid = $1`, [sid])
      const cSids = cs.rows.map((x) => x.sid)
      await client.query(`delete from ${tq('content_likes')} where kind = 'event_comment' and target_sid = any($1::text[])`, [cSids])
      await client.query(`delete from ${tq('event_comments')} where event_sid = $1`, [sid])
      await client.query(`delete from ${tq('event_attendees')} where event_sid = $1`, [sid])
      await client.query(`delete from ${tq('checkins')} where event_sid = $1`, [sid])
      await client.query(`delete from ${tq('contacts')} where event_sid = $1`, [sid])
      await client.query(`delete from ${tq('reminders')} where event_sid = $1`, [sid])
      await client.query(`delete from ${tq('favorites')} where fav_type = 'events' and target_sid = $1`, [sid])
    }
    await client.query(`delete from ${tq(table)} where id = $1`, [row.id])
    await client.query('commit')
    console.log(`content-cascade-delete: ${table}/${sid}`)
  } catch (e) {
    try { await client.query('rollback') } catch { /* 已断开 */ }
    throw e
  } finally {
    client.release()
  }
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
    // 试点内部行为/反馈表不挂通用权限；注销时动态确认存在后清理双方关联数据。
    const internalTables = await client.query(
      `select table_name from information_schema.tables where table_schema = $1 and table_name = any($2::text[])`,
      [SCHEMA, ['discovery_exposures', 'relationship_feedback']],
    )
    const internal = new Set(internalTables.rows.map(row => String(row.table_name)))
    if (internal.has('discovery_exposures')) {
      await client.query(`delete from ${tq('discovery_exposures')} where viewer_sid = $1 or target_sid = $1`, [id])
    }
    if (internal.has('relationship_feedback')) {
      await client.query(`delete from ${tq('relationship_feedback')} where owner_sid = $1 or other_sid = $1`, [id])
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

function needAdmin(auth) {
  needAuth(auth)
  if (auth.role !== 'admin') throw new HttpErr(403, 'You are not allowed to perform this operation.')
  return auth
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

function normalizeFavoriteGroupName(value, required = true) {
  const name = String(value ?? '').trim()
  if (!name && !required) return ''
  if (!name) throw new HttpErr(400, 'Validation failed.', { name: { message: '给分组起个名字吧' } })
  if ([...name].length > 6) throw new HttpErr(400, 'Validation failed.', { name: { message: '分组名至多 6 个字' } })
  return name
}

/** 收藏分组原子操作：新增 / 删除 / 重命名 / 分配均在服务端事务内完成。 */
async function handleFavoriteGroupAction(body, auth) {
  needAuth(auth)
  const action = String(body?.action ?? '')
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select id from ${tq('users')} where id = $1 for update`, [auth.id])

    if (action === 'add') {
      const name = normalizeFavoriteGroupName(body?.name)
      const cnt = await client.query(`select count(*)::int n from ${tq('fav_groups')} where owner_sid = $1`, [auth.id])
      if (Number(cnt.rows[0]?.n ?? 0) >= 6) throw new HttpErr(400, 'Validation failed.', { name: { message: '至多 6 个分组' } })
      const dup = await client.query(`select 1 from ${tq('fav_groups')} where owner_sid = $1 and name = $2 limit 1`, [auth.id, name])
      if (dup.rows[0]) throw new HttpErr(400, 'Validation failed.', { name: { message: '已有同名分组' } })
      await client.query(
        `insert into ${tq('fav_groups')} (id, sid, owner_sid, name, created, updated) values ($1,$2,$3,$4,now(),now())`,
        [genId(), `${auth.id}:${name}`, auth.id, name],
      )
    } else if (action === 'remove') {
      const name = normalizeFavoriteGroupName(body?.name)
      await client.query(`update ${tq('favorites')} set group_name = '', updated = now() where owner_sid = $1 and group_name = $2`, [auth.id, name])
      await client.query(`delete from ${tq('fav_groups')} where owner_sid = $1 and name = $2`, [auth.id, name])
    } else if (action === 'rename') {
      const oldName = normalizeFavoriteGroupName(body?.name)
      const newName = normalizeFavoriteGroupName(body?.newName)
      if (oldName !== newName) {
        const old = await client.query(`select id from ${tq('fav_groups')} where owner_sid = $1 and name = $2 limit 1`, [auth.id, oldName])
        if (!old.rows[0]) throw new HttpErr(404, '收藏分组不存在或已删除')
        const dup = await client.query(`select 1 from ${tq('fav_groups')} where owner_sid = $1 and name = $2 limit 1`, [auth.id, newName])
        if (dup.rows[0]) throw new HttpErr(400, 'Validation failed.', { name: { message: '已有同名分组' } })
        await client.query(`update ${tq('favorites')} set group_name = $3, updated = now() where owner_sid = $1 and group_name = $2`, [auth.id, oldName, newName])
        await client.query(`update ${tq('fav_groups')} set sid = $3, name = $4, updated = now() where id = $2 and owner_sid = $1`, [auth.id, old.rows[0].id, `${auth.id}:${newName}`, newName])
      }
    } else if (action === 'assign') {
      const type = String(body?.type ?? '')
      const targetId = String(body?.targetId ?? '').trim()
      const group = normalizeFavoriteGroupName(body?.group, false)
      if (!['users', 'posts', 'events'].includes(type) || !targetId) throw new HttpErr(400, 'Validation failed.', { favorite: { message: '收藏对象无效' } })
      if (group) {
        const exists = await client.query(`select 1 from ${tq('fav_groups')} where owner_sid = $1 and name = $2 limit 1`, [auth.id, group])
        if (!exists.rows[0]) throw new HttpErr(400, 'Validation failed.', { group: { message: '收藏分组不存在' } })
      }
      const updated = await client.query(
        `update ${tq('favorites')} set group_name = $4, updated = now() where owner_sid = $1 and fav_type = $2 and target_sid = $3 returning id`,
        [auth.id, type, targetId, group],
      )
      if (!updated.rows[0]) throw new HttpErr(404, '收藏记录不存在或已取消')
    } else {
      throw new HttpErr(400, 'Validation failed.', { action: { message: '收藏分组操作无效' } })
    }

    await client.query('commit')
    return { ok: true }
  } catch (e) {
    try { await client.query('rollback') } catch { /* 已断开 */ }
    throw e
  } finally {
    client.release()
  }
}

/**
 * 掌柜重置会员密码（v1.6 补齐账号找回路径）：
 * 生成一次性临时密码（去易混淆字符），落库为哈希，明文只在本次响应返回。
 * 服务端日志留痕重置事件（不含明文）；运营日志由前端掌柜侧补记。
 */
// ---------- v1.8 图片上传（附件落盘，不再以 dataURL 挤占数据库与同步载荷） ----------

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads')
const UPLOAD_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }
const UPLOAD_MAX_BYTES = 8e6 // 解码后上限；前端已压缩到最长边 600–900 的 JPEG，正常 <400KB
const UPLOAD_PURPOSES = new Set(['profile', 'post', 'event', 'chat', 'admin'])

function uploadCapabilitySig(name) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`upload:${name}`).digest('base64url').slice(0, 32)
}

function safeSigEqual(actual, expected) {
  const a = Buffer.from(String(actual ?? ''))
  const b = Buffer.from(String(expected ?? ''))
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function validImageMagic(buf, mime) {
  if (mime === 'image/jpeg') return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  if (mime === 'image/png') return buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
  if (mime === 'image/gif') return buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))
  if (mime === 'image/webp') return buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP'
  return false
}

/** 登录成员上传：用途分类 + 不可猜文件名 + HMAC capability URL。 */
async function handleUpload(body, auth) {
  needAuth(auth)
  const purpose = String(body?.purpose ?? '').trim()
  if (!UPLOAD_PURPOSES.has(purpose)) {
    throw new HttpErr(400, 'Validation failed.', { purpose: { message: '图片用途无效' } })
  }
  const data = String(body?.image ?? '')
  const m = data.match(/^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/i)
  const mime = m ? m[1].toLowerCase() : ''
  const ext = m ? UPLOAD_TYPES[mime] : null
  if (!ext) throw new HttpErr(400, 'Validation failed.', { image: { message: '仅支持 jpeg / png / webp / gif 图片' } })
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64')
  if (!buf.length) throw new HttpErr(400, 'Validation failed.', { image: { message: '图片内容为空' } })
  if (buf.length > UPLOAD_MAX_BYTES) throw new HttpErr(413, '图片过大（上限 8MB）')
  if (!validImageMagic(buf, mime)) throw new HttpErr(400, 'Validation failed.', { image: { message: '图片内容与格式不一致' } })
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  const name = `v2-${purpose}-${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${ext}`
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buf, { flag: 'wx' })
  METRICS.uploads.count += 1
  METRICS.uploads.bytes += buf.length
  secEvent('image_uploaded', { actorSid: auth.id, detail: { purpose, bytes: buf.length } })
  const sig = uploadCapabilitySig(name)
  return { url: `/api/uploads/${name}?sig=${encodeURIComponent(sig)}`, bytes: buf.length, purpose }
}

/**
 * 读上传文件：仅允许 v2 capability URL。
 * 2026-09-28 已确认 public 数据库旧引用为 0，legacy unsigned fallback 正式关闭；
 * 磁盘上即使仍残留旧文件，也不再通过 HTTP 暴露。
 */
function handleUploadRead(name, url, res) {
  const v2 = /^v2-(profile|post|event|chat|admin)-[a-z0-9]+-[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(name)
  if (!v2) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  if (!safeSigEqual(url.searchParams.get('sig'), uploadCapabilitySig(name))) {
    throw new HttpErr(404, 'The requested resource wasn\'t found.')
  }
  const fp = path.join(UPLOAD_DIR, name)
  if (!fs.existsSync(fp)) throw new HttpErr(404, 'The requested resource wasn\'t found.')
  const type = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(name)]
  const size = fs.statSync(fp).size
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  fs.createReadStream(fp).pipe(res)
}

// ---------- HTTP 层 ----------

function send(res, status, body) {
  const payload = body === null ? null : JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    // Standalone production UI/API share an origin; wildcard CORS is unnecessary there.
    ...(!SERVE_STATIC ? {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Pb-Auth',
    } : {}),
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
  if (STAGING_MODE) {
    // Search-crawler exclusion is not authentication: keep staging behind an access gate.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
    res.setHeader('Cache-Control', 'no-store')
  }
  const t0 = Date.now()
  const url = new URL(req.url, 'http://localhost')
  // 旧版 /__pb/api 路径只作为升级过渡兼容；独立前端直接请求 /api。
  const path = SERVE_STATIC && (url.pathname === '/__pb/api' || url.pathname.startsWith('/__pb/api/'))
    ? url.pathname.slice('/__pb'.length) : url.pathname
  try {
    if (staticSite && staticSite(req, res, path)) return
    if (req.method === 'OPTIONS') return send(res, 204, null)

    if ((path === '/api/ready' || path === '/api/ready/') && req.method === 'GET') {
      // Readiness validates the DB connection and auth bootstrap, unlike shallow liveness.
      await q('select 1')
      if (!JWT_SECRET || !COLUMNS.has('users') || !COLUMNS.has('profiles')) {
        throw new HttpErr(503, '数据服务尚未完成启动')
      }
      return send(res, 200, { code: 200, message: 'API is ready.', data: { ready: true } })
    }

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

    if ((path === '/api/profiles/lookup' || path === '/api/profiles/lookup/') && req.method === 'GET') {
      return send(res, 200, await handleProfileLookup(url, auth))
    }

    if ((path === '/api/discovery/profiles' || path === '/api/discovery/profiles/') && req.method === 'GET') {
      return send(res, 200, await handleDiscoveryProfiles(url, auth))
    }

    if ((path === '/api/community/posts' || path === '/api/community/posts/') && req.method === 'GET') {
      return send(res, 200, await handleCommunityPosts(url, auth))
    }
    if ((path === '/api/community/digests' || path === '/api/community/digests/') && req.method === 'GET') {
      return send(res, 200, await handleCommunityDigests(auth))
    }

    if ((path === '/api/events/list' || path === '/api/events/list/') && req.method === 'GET') {
      return send(res, 200, await eventHandlers.handleEventList(url, auth))
    }
    if ((path === '/api/me/activity-stats' || path === '/api/me/activity-stats/') && req.method === 'GET') {
      return send(res, 200, await eventHandlers.handleMyActivityStats(auth))
    }
    if ((path === '/api/me/visits' || path === '/api/me/visits/') && req.method === 'GET') {
      return send(res, 200, await handleMyVisits(url, auth))
    }
    if ((path === '/api/me/chat-activity' || path === '/api/me/chat-activity/') && req.method === 'GET') {
      return send(res, 200, await handleChatActivity(url, auth))
    }
    let relationshipFeedbackMatch = path.match(/^\/api\/me\/relationship-feedback\/([^/]+)\/?$/)
    if (relationshipFeedbackMatch && req.method === 'GET') {
      return send(res, 200, await handleRelationshipFeedback(decodeURIComponent(relationshipFeedbackMatch[1]), auth))
    }
    if (relationshipFeedbackMatch && req.method === 'PUT') {
      return send(res, 200, await handleRelationshipFeedbackSet(decodeURIComponent(relationshipFeedbackMatch[1]), await readBody(req), auth))
    }
    if ((path === '/api/me/reports' || path === '/api/me/reports/') && req.method === 'GET') {
      return send(res, 200, await safetyHandlers.handleMyReports(auth))
    }
    let eventDetailMatch = path.match(/^\/api\/events\/([^/]+)\/detail\/?$/)
    if (eventDetailMatch && req.method === 'GET') {
      return send(res, 200, await eventHandlers.handleEventDetail(decodeURIComponent(eventDetailMatch[1]), auth))
    }

    if ((path === '/api/chats/summaries' || path === '/api/chats/summaries/') && req.method === 'GET') {
      return send(res, 200, await handleChatSummaries(auth))
    }
    let chatConversationMatch = path.match(/^\/api\/chats\/([^/]+)\/messages\/?$/)
    if (chatConversationMatch && req.method === 'GET') {
      return send(res, 200, await handleChatConversation(decodeURIComponent(chatConversationMatch[1]), auth))
    }

    if ((path === '/api/favorites/groups' || path === '/api/favorites/groups/') && req.method === 'POST') {
      return send(res, 200, await handleFavoriteGroupAction(await readBody(req), auth))
    }

    // 活动现场核销：主办方取码，报名成员凭码签到。
    let checkinMatch = path.match(/^\/api\/events\/([^/]+)\/checkin-code\/?$/)
    if (checkinMatch && req.method === 'GET') {
      return send(res, 200, await eventHandlers.handleEventCheckinCode(decodeURIComponent(checkinMatch[1]), auth))
    }
    checkinMatch = path.match(/^\/api\/events\/([^/]+)\/checkin\/?$/)
    if (checkinMatch && req.method === 'POST') {
      return send(res, 200, await eventHandlers.handleEventCheckin(decodeURIComponent(checkinMatch[1]), await readBody(req), auth))
    }

    // 认证接口（另加单 IP 尝试频次限制，防爆破的第一道闸；身份级锁定见 handleAuthWithPassword）
    let m = path.match(/^\/api\/collections\/users\/auth-with-password\/?$/)
    if (m && req.method === 'POST') {
      rateGate(`a:${ip}`, 60, 600_000, '尝试次数过多，请稍后再试')
      const out = await authHandlers.handleAuthWithPassword(await readBody(req), ip)
      return send(res, 200, out)
    }
    m = path.match(/^\/api\/collections\/users\/auth-refresh\/?$/)
    if (m && req.method === 'POST') {
      const out = await authHandlers.handleAuthRefresh(auth)
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
      const out = await adminHandlers.handleAdminResetPassword(decodeURIComponent(m[1]), auth)
      return send(res, 200, out)
    }

    m = path.match(/^\/api\/admin\/reports\/([^/]+)\/resolve\/?$/)
    if (m && req.method === 'POST') {
      return send(res, 200, await safetyHandlers.handleAdminResolveReport(decodeURIComponent(m[1]), await readBody(req), auth))
    }
    m = path.match(/^\/api\/reports\/([^/]+)\/appeal\/?$/)
    if (m && req.method === 'POST') {
      return send(res, 200, await safetyHandlers.handleReportAppeal(decodeURIComponent(m[1]), await readBody(req), auth))
    }

    // 安全事件查询（仅掌柜；v1.12）
    if ((path === '/api/admin/security-events' || path === '/api/admin/security-events/') && req.method === 'GET') {
      return send(res, 200, await safetyHandlers.handleAdminSecurityEvents(url, auth))
    }

    // 敏感词表维护（仅掌柜；v1.12）
    if ((path === '/api/admin/word-filter' || path === '/api/admin/word-filter/') && (req.method === 'GET' || req.method === 'PUT')) {
      const body = req.method === 'PUT' ? await readBody(req) : null
      return send(res, 200, await safetyHandlers.handleAdminWordFilter(req, body, auth))
    }

    // 图片上传（登录成员）与读取（文件名不可猜测，凭 URL 访问）
    if ((path === '/api/uploads' || path === '/api/uploads/') && req.method === 'POST') {
      if (!mayStoreUpload(process.env)) throw new HttpErr(503, '免费预览环境未启用持久图片存储，请勿上传真人照片')
      return send(res, 200, await handleUpload(await readBody(req), auth))
    }
    m = path.match(/^\/api\/uploads\/([^/]+)$/)
    if (m && req.method === 'GET') {
      handleUploadRead(decodeURIComponent(m[1]), url, res)
      return
    }

    // 运行指标（仅掌柜；内存计数，重启清零，不含业务数据）
    if ((path === '/api/metrics' || path === '/api/metrics/') && req.method === 'GET') {
      return send(res, 200, adminHandlers.handleMetrics(auth))
    }
    if ((path === '/api/admin/pilot-metrics' || path === '/api/admin/pilot-metrics/') && req.method === 'GET') {
      return send(res, 200, await adminHandlers.handlePilotMetrics(url, auth))
    }

    // 记录接口
    m = path.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?\/?$/)
    if (m) {
      const table = decodeURIComponent(m[1])
      const id = m[2] ? decodeURIComponent(m[2]) : null
      // 未挂权限规则的表（gateway_meta 密钥表、security_events 内部审计表）不经通用集合接口暴露
      if (!COLUMNS.has(table) || !RULES[table]) {
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

async function ensureSchemaMigrations() {
  await q(`alter table if exists ${tq('reports')} add column if not exists resolution text`)
  await q(`alter table if exists ${tq('reports')} add column if not exists resolved_at double precision`)
  await q(`alter table if exists ${tq('reports')} add column if not exists appeal_note text`)
  await q(`alter table if exists ${tq('reports')} add column if not exists appeal_at double precision`)
  await q(`alter table if exists ${tq('reports')} add column if not exists appeal_status text`)
}

async function main() {
  if (SERVE_STATIC) {
    staticSite = createStaticSiteHandler({ directory: process.env.STATIC_DIR ?? path.resolve(process.cwd(), 'dist') })
  }
  // fresh DB 先确保 schema 存在，再执行增量迁移；迁移后重新读取列元数据。
  await loadColumns()
  await ensureSchemaMigrations()
  await loadColumns()
  await loadSecret()
  await bootstrapConfiguredAdmins()
  await loadBlockedWords()
  const tables = [...COLUMNS.keys()].filter((t) => RULES[t])
  console.log(`Neon 网关就绪：${tables.length} 张业务表，schema ${SCHEMA}，端口 ${PORT}`)
  server.listen(PORT, HOST)
}

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000)
})

main().catch((e) => {
  console.error('启动失败:', e.message)
  process.exit(1)
})
