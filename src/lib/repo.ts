import { pb } from './pb'
import type { EventItem, Post, ReportRec, Settings, User, Visit, WeeklyDigest } from './store'

// 仓库层 v2(Repository): 一实体一表, 前端唯一允许直接碰 PocketBase 的地方。
// 读取: loadWorld() 把各表装配成前端状态; 写回: syncWorld() 差量 create/update/delete。
// 私有表只同步「我」的行; 公开表同步全量。

interface Row {
  id: string
  sid: string
  [k: string]: unknown
}
type RowMap = Map<string, Row & { _key?: string }>
const cache: Record<string, RowMap> = {}

async function loadCol(col: string, enabled = true): Promise<Row[]> {
  if (!enabled) {
    cache[col] = new Map()
    return []
  }
  const items: Row[] = []
  let page = 1
  for (;;) {
    const res = await pb.collection(col).getList(page, 200)
    if (!Array.isArray(res.items) || !Number.isSafeInteger(res.totalPages) || res.totalPages < 0 || res.page !== page) {
      throw new Error('数据库接口返回异常，请检查后端服务和 /__pb 代理配置')
    }
    items.push(...(res.items as unknown as Row[]))
    if (page >= res.totalPages) break
    page++
  }
  cache[col] = new Map(items.map(r => [r.sid, r]))
  return items
}

async function syncCollection(
  col: string,
  rows: Array<{ sid: string; fields: Record<string, unknown> }>,
  opts?: { owns?: (r: Row) => boolean; skipCreate?: (r: { sid: string; fields: Record<string, unknown> }) => boolean },
) {
  const map = cache[col] ?? new Map<string, Row & { _key?: string }>()
  const seen = new Set<string>()
  const ops: Array<Promise<unknown>> = []
  for (const r of rows) {
    seen.add(r.sid)
    const key = JSON.stringify(r.fields)
    const old = map.get(r.sid)
    if (!old) {
      // 种子归属行:服务端 create 已收紧到本人署名,客户端不再有权创建。
      // 跳过以免每轮同步静默重试 403(全新环境由种子脚本灌入,见 docs/12)。
      if (opts?.skipCreate?.(r)) continue
      ops.push(
        pb
          .collection(col)
          .create({ sid: r.sid, ...r.fields })
          .then(nr => map.set(r.sid, Object.assign(nr as unknown as Row, { _key: key })))
          .catch(() => {}),
      )
    } else if (old._key !== key) {
      ops.push(
        pb
          .collection(col)
          .update(old.id, r.fields)
          .then(nr => map.set(r.sid, Object.assign(nr as unknown as Row, { _key: key })))
          .catch(() => {}),
      )
    }
  }
  // 删除护栏: 私有表只删自己的行; 公开表单轮删除量过大(疑似残缺状态)时跳过删除, 防整表误删
  // 比例按「实际会删的行」(guarded)计算: 公开缓存里别人的行不参与, 否则会误伤自己的取消操作
  const missing = [...map.keys()].filter(sid => !seen.has(sid))
  const guarded = missing.filter(sid => {
    const row = map.get(sid)
    if (opts?.owns && row && !opts.owns(row)) return false
    return true
  })
  const ratioOk = map.size <= 4 || guarded.length <= Math.max(2, Math.floor(map.size * 0.25))
  if (ratioOk) {
    for (const sid of guarded) {
      const old = map.get(sid)
      if (!old) continue
      ops.push(
        pb
          .collection(col)
          .delete(old.id)
          .then(() => map.delete(sid))
          .catch(() => {}),
      )
    }
  }
  await Promise.all(ops)
}

// ---------- 读取装配 ----------

export interface World {
  users: User[]
  posts: Post[]
  events: EventItem[]
  settings: Settings | null
  digests: WeeklyDigest[]
  reports: ReportRec[]
  adminLogs: Array<{ id: string; at: number; text: string }>
  match: { likes: Record<string, string[]>; passes: Record<string, string[]>; chats: Record<string, ChatRow[]>; reads: Record<string, number> }
  favs: { users: string[]; posts: string[]; events: string[] }
  favmeta: { groups: string[]; of: Record<string, string> }
  visits: Record<string, Visit[]>
  blocks: string[]
  reminders: string[]
  checkins: Record<string, string[]>
  contacts: Record<string, Record<string, string>>
  tour: Record<string, boolean>
  empty: boolean
}

interface ChatRow {
  id: string
  from: string
  text: string
  at: number
  read?: boolean
  recalled?: boolean
  images?: string[]
}

const j = (v: unknown, fb: unknown) => (v == null ? fb : v)

export async function loadWorld(meId: string | null): Promise<World> {
  const signedIn = !!meId
  const [profiles, postsR, pcR, eventsR, ecR, cmR, ulR, upR, urR, favR, fgR, visR, blR, reR, ciR, coR, rpR, dgR, ssR, tourR, clR, eaR] =
    await Promise.all([
      loadCol('profiles'),
      loadCol('posts'),
      loadCol('post_comments'),
      loadCol('events'),
      loadCol('event_comments'),
      loadCol('chat_messages', signedIn),
      loadCol('user_likes', signedIn),
      loadCol('user_passes', signedIn),
      loadCol('user_reads', signedIn),
      loadCol('favorites', signedIn),
      loadCol('fav_groups', signedIn),
      loadCol('visits', signedIn),
      loadCol('blocks', signedIn),
      loadCol('reminders', signedIn),
      loadCol('checkins', signedIn),
      loadCol('contacts', signedIn),
      loadCol('reports', signedIn),
      loadCol('digests'),
      loadCol('site_settings'),
      loadCol('user_tour', signedIn),
      loadCol('content_likes'),
      loadCol('event_attendees'),
    ])
  const isAdmin = signedIn && profiles.some(row => row.sid === meId && row.role === 'admin')
  const alR = await loadCol('admin_logs', isAdmin)

  // 计数拆分表装配: kind:target -> 点赞人名单; event -> 报名名单(按创建序)
  const likesBy = new Map<string, string[]>()
  for (const r of clR) {
    const k = `${String(r.kind)}:${String(r.target_sid)}`
    const list = likesBy.get(k)
    if (list) list.push(String(r.owner_sid))
    else likesBy.set(k, [String(r.owner_sid)])
  }
  const roster = (k: string) => likesBy.get(k) ?? []
  const attendeesBy = new Map<string, string[]>()
  for (const r of eaR) {
    const k = String(r.event_sid)
    const list = attendeesBy.get(k)
    if (list) list.push(String(r.owner_sid))
    else attendeesBy.set(k, [String(r.owner_sid)])
  }

  const users: User[] = profiles.map(r => ({
    id: r.sid,
    phone: '',
    password: '',
    nickname: String(r.nickname ?? ''),
    gender: (String(r.gender ?? 'unknown') as User['gender']) || 'unknown',
    seeking: (String(r.seeking ?? 'unknown') as User['seeking']) || 'unknown',
    birthDate: String(r.birth_date ?? ''),
    city: String(r.city ?? ''),
    region: r.region ? String(r.region) : undefined,
    height: Number(r.height ?? 0),
    job: String(r.job ?? ''),
    bio: String(r.bio ?? ''),
    interests: (j(r.interests, []) as string[]) ?? [],
    photos: (j(r.photos, []) as string[]) ?? [],
    verification: (j(r.verification, { phone: false, realname: false, photo: false }) as User['verification']),
    badgeDates: (j(r.badge_dates, {}) as Record<string, number>) ?? {},
    createdAt: Number(r.created_at ?? Date.now()),
    stealth: !!r.stealth,
    role: r.role === 'admin' ? 'admin' : undefined,
    banned: !!r.banned,
  }))

  const posts: Post[] = postsR.map(r => ({
    id: r.sid,
    authorId: String(r.author_sid ?? ''),
    text: String(r.text ?? ''),
    images: (j(r.images, []) as string[]) ?? [],
    topic: String(r.topic ?? ''),
    featured: !!r.featured,
    likes: roster(`post:${r.sid}`),
    comments: [],
    at: Number(r.at ?? 0),
  }))
  for (const c of pcR) {
    const p = posts.find(x => x.id === c.post_sid)
    if (p) p.comments.push({ id: c.sid, authorId: String(c.author_sid ?? ''), text: String(c.text ?? ''), at: Number(c.at ?? 0), likes: roster(`post_comment:${c.sid}`) })
  }
  for (const p of posts) p.comments.sort((a, b) => a.at - b.at)

  const events: EventItem[] = eventsR.map(r => ({
    id: r.sid,
    title: String(r.title ?? ''),
    city: String(r.city ?? ''),
    region: r.region ? String(r.region) : undefined,
    cover: String(r.cover ?? ''),
    date: String(r.date ?? ''),
    time: String(r.time ?? ''),
    capacity: Number(r.capacity ?? 0),
    desc: String(r.desc ?? ''),
    tags: (j(r.tags, []) as string[]) ?? [],
    attendees: attendeesBy.get(r.sid) ?? [],
    host: String(r.host ?? ''),
    creatorId: r.creator_sid ? String(r.creator_sid) : undefined,
    requirements: r.requirements ? String(r.requirements) : undefined,
    pinned: !!r.pinned,
    images: (j(r.images, []) as string[]) ?? [],
    comments: [],
  }))
  for (const c of ecR) {
    const ev = events.find(x => x.id === c.event_sid)
    if (ev) (ev.comments ??= []).push({ id: c.sid, authorId: String(c.author_sid ?? ''), text: String(c.text ?? ''), at: Number(c.at ?? 0), likes: roster(`event_comment:${c.sid}`), pinned: !!c.pinned })
  }
  for (const ev of events) (ev.comments ?? []).sort((a, b) => a.at - b.at)

  const likes: Record<string, string[]> = {}
  for (const r of ulR) (likes[String(r.owner_sid)] ??= []).push(String(r.target_sid))
  const passes: Record<string, string[]> = {}
  for (const r of upR) (passes[String(r.owner_sid)] ??= []).push(String(r.target_sid))
  const chats: Record<string, ChatRow[]> = {}
  for (const r of cmR) {
    const key = [String(r.sid_a), String(r.sid_b)].sort().join(':')
    ;(chats[key] ??= []).push({
      id: r.sid,
      from: String(r.from_sid ?? ''),
      text: String(r.text ?? ''),
      at: Number(r.at ?? 0),
      recalled: !!r.recalled,
      read: Number(r.read_at ?? 0) === 1 ? true : undefined,
      images: (j(r.images, []) as string[]) ?? [],
    })
  }
  for (const k of Object.keys(chats)) chats[k].sort((a, b) => a.at - b.at)
  const reads: Record<string, number> = {}
  for (const r of urR) if (meId && String(r.owner_sid) === meId) reads[String(r.other_sid)] = Number(r.at ?? 0)

  const favs = { users: [] as string[], posts: [] as string[], events: [] as string[] }
  const of: Record<string, string> = {}
  for (const r of favR) {
    const t = String(r.fav_type)
    const target = String(r.target_sid)
    if (t === 'users') favs.users.push(target)
    else if (t === 'posts') favs.posts.push(target)
    else favs.events.push(target)
    if (r.group_name) of[target] = String(r.group_name)
  }
  const favmeta = { groups: fgR.map(r => String(r.name)), of }

  const visits: Record<string, Visit[]> = {}
  for (const r of visR) (visits[String(r.viewed_sid)] ??= []).push({ id: String(r.viewer_sid), at: Number(r.at ?? 0) })
  for (const k of Object.keys(visits)) visits[k].sort((a, b) => b.at - a.at)

  const mine = (r: Row) => String(r.owner_sid) === meId
  const blocks = blR.filter(mine).map(r => String(r.target_sid))
  const reminders = reR.filter(mine).map(r => String(r.event_sid))
  const checkins: Record<string, string[]> = {}
  if (meId) checkins[meId] = ciR.filter(mine).map(r => String(r.event_sid))
  const contacts: Record<string, Record<string, string>> = {}
  for (const r of coR) (contacts[String(r.event_sid)] ??= {})[String(r.user_sid)] = String(r.text ?? '')
  const tourRow = tourR.find(mine)
  const tour = (tourRow?.data as Record<string, boolean>) ?? {}

  const reports: ReportRec[] = rpR.map(r => ({
    id: r.sid,
    by: String(r.by_sid ?? ''),
    target: String(r.target_sid ?? ''),
    reason: String(r.reason ?? ''),
    note: String(r.note ?? ''),
    at: Number(r.at ?? 0),
    status: (String(r.status ?? 'open') as ReportRec['status']),
  }))
  const digests: WeeklyDigest[] = dgR
    .map(r => ({
      id: r.sid,
      issue: Number(r.issue ?? 0),
      title: String(r.title ?? ''),
      intro: String(r.intro ?? ''),
      postIds: (j(r.post_sids, []) as string[]) ?? [],
      at: Number(r.at ?? 0),
      cover: r.cover ? String(r.cover) : undefined,
      covers: (j(r.covers, []) as string[]) ?? [],
      views: Number(r.views ?? 0),
    }))
    .sort((a, b) => b.at - a.at)
  const adminLogs = alR
    .map(r => ({ id: r.sid, at: Number(r.at ?? 0), text: String(r.text ?? '') }))
    .sort((a, b) => b.at - a.at)

  const ss = ssR[0]
  const settings: Settings | null = ss
    ? {
        features: (j(ss.features, {}) as Settings['features']),
        stories: (j(ss.stories, []) as Settings['stories']),
        announcement: String(ss.announcement ?? ''),
        hiddenEvents: (j(ss.hidden_events, []) as string[]) ?? [],
        festTemplates: (j(ss.fest_templates, {}) as Settings['festTemplates']),
      }
    : null

  return {
    users,
    posts,
    events,
    settings,
    digests,
    reports,
    adminLogs,
    match: { likes, passes, chats, reads },
    favs,
    favmeta,
    visits,
    blocks,
    reminders,
    checkins,
    contacts,
    tour,
    empty: profiles.length === 0 && postsR.length === 0,
  }
}

// ---------- 写回(差量) ----------

export interface WorldState {
  users: User[]
  posts: Post[]
  events: EventItem[]
  settings: Settings
  digests: WeeklyDigest[]
  reports: ReportRec[]
  adminLogs: Array<{ id: string; at: number; text: string }>
  match: { likes: Record<string, string[]>; passes: Record<string, string[]>; chats: Record<string, ChatRow[]>; reads: Record<string, number> }
  favs: { users: string[]; posts: string[]; events: string[] }
  favmeta: { groups: string[]; of: Record<string, string> }
  visits: Record<string, Visit[]>
  blocks: string[]
  reminders: string[]
  checkins: Record<string, string[]>
  contacts: Record<string, Record<string, string>>
  tour: Record<string, boolean>
}

export async function syncWorld(s: WorldState, meId: string, seedIds?: ReadonlySet<string>): Promise<void> {
  // 种子内容(演示数据)不再由客户端创建:归属种子用户、或官方活动(creator_sid 为空)即跳过建行
  const seeded = (v: unknown) => (!v ? false : (seedIds?.has(String(v)) ?? false))
  await Promise.all([
    syncCollection(
      'profiles',
      s.users.map(u => ({
        sid: u.id,
        fields: {
          nickname: u.nickname,
          gender: u.gender,
          seeking: u.seeking,
          birth_date: u.birthDate,
          city: u.city,
          region: u.region ?? '',
          height: u.height,
          job: u.job,
          bio: u.bio,
          interests: u.interests,
          photos: u.photos,
          verification: u.verification,
          badge_dates: u.badgeDates ?? {},
          stealth: !!u.stealth,
          banned: !!u.banned,
          role: u.role ?? '',
          created_at: u.createdAt,
        },
      })),
      { skipCreate: r => seeded(r.sid) },
    ),
    syncCollection(
      'posts',
      s.posts.map(p => ({
        sid: p.id,
        fields: { author_sid: p.authorId, text: p.text, images: p.images, topic: p.topic, featured: !!p.featured, at: p.at },
      })),
      { skipCreate: r => seeded(r.fields.author_sid) },
    ),
    syncCollection(
      'post_comments',
      s.posts.flatMap(p => p.comments.map(c => ({ sid: c.id, fields: { post_sid: p.id, author_sid: c.authorId, text: c.text, at: c.at } }))),
      { skipCreate: r => seeded(r.fields.author_sid) },
    ),
    syncCollection(
      'events',
      s.events.map(ev => ({
        sid: ev.id,
        fields: {
          title: ev.title,
          city: ev.city,
          region: ev.region ?? '',
          cover: ev.cover,
          date: ev.date,
          time: ev.time,
          capacity: ev.capacity,
          desc: ev.desc,
          tags: ev.tags,
          host: ev.host,
          creator_sid: ev.creatorId ?? '',
          requirements: ev.requirements ?? '',
          pinned: !!ev.pinned,
          images: ev.images ?? [],
        },
      })),
      { skipCreate: r => seeded(r.fields.creator_sid) || !r.fields.creator_sid },
    ),
    syncCollection(
      'event_comments',
      s.events.flatMap(ev => (ev.comments ?? []).map(c => ({ sid: c.id, fields: { event_sid: ev.id, author_sid: c.authorId, text: c.text, pinned: !!c.pinned, at: c.at } }))),
      { skipCreate: r => seeded(r.fields.author_sid) },
    ),
    // 计数拆分表: 只写「我」的点赞/报名行, 名单由服务端按行聚合
    syncCollection(
      'content_likes',
      [
        ...s.posts.flatMap(p => [
          ...(p.likes.includes(meId) ? [{ sid: `post:${p.id}:${meId}`, fields: { kind: 'post', target_sid: p.id, owner_sid: meId } }] : []),
          ...p.comments.flatMap(c =>
            (c.likes ?? []).includes(meId) ? [{ sid: `post_comment:${c.id}:${meId}`, fields: { kind: 'post_comment', target_sid: c.id, owner_sid: meId } }] : [],
          ),
        ]),
        ...s.events.flatMap(ev =>
          (ev.comments ?? []).flatMap(c =>
            (c.likes ?? []).includes(meId) ? [{ sid: `event_comment:${c.id}:${meId}`, fields: { kind: 'event_comment', target_sid: c.id, owner_sid: meId } }] : [],
          ),
        ),
      ],
      { owns: r => String(r.owner_sid) === meId },
    ),
    syncCollection(
      'event_attendees',
      s.events.filter(ev => ev.attendees.includes(meId)).map(ev => ({ sid: `${ev.id}:${meId}`, fields: { event_sid: ev.id, owner_sid: meId } })),
      { owns: r => String(r.owner_sid) === meId },
    ),
    syncCollection(
      'chat_messages',
      Object.entries(s.match.chats).flatMap(([key, msgs]) => {
        const [a, b] = key.split(':')
        if (a !== meId && b !== meId) return []
        return msgs.map(m => ({
          sid: m.id,
          fields: { sid_a: a, sid_b: b, from_sid: m.from, text: m.text, images: m.images ?? [], recalled: !!m.recalled, read_at: m.read ? 1 : 0, at: m.at },
        }))
      }),
      { owns: r => String(r.from_sid) === meId },
    ),
    syncCollection('user_likes', (s.match.likes[meId] ?? []).map(t => ({ sid: `${meId}:${t}`, fields: { owner_sid: meId, target_sid: t } })), { owns: r => String(r.owner_sid) === meId }),
    syncCollection('user_passes', (s.match.passes[meId] ?? []).map(t => ({ sid: `${meId}:${t}`, fields: { owner_sid: meId, target_sid: t } })), { owns: r => String(r.owner_sid) === meId }),
    syncCollection(
      'user_reads',
      Object.entries(s.match.reads).map(([other, at]) => ({ sid: `${meId}:${other}`, fields: { owner_sid: meId, other_sid: other, at } })),
      { owns: r => String(r.owner_sid) === meId },
    ),
    syncCollection(
      'favorites',
      [
        ...s.favs.users.map(t => ({ sid: `${meId}:users:${t}`, fields: { owner_sid: meId, fav_type: 'users', target_sid: t, group_name: s.favmeta.of[t] ?? '' } })),
        ...s.favs.posts.map(t => ({ sid: `${meId}:posts:${t}`, fields: { owner_sid: meId, fav_type: 'posts', target_sid: t, group_name: s.favmeta.of[t] ?? '' } })),
        ...s.favs.events.map(t => ({ sid: `${meId}:events:${t}`, fields: { owner_sid: meId, fav_type: 'events', target_sid: t, group_name: s.favmeta.of[t] ?? '' } })),
      ],
      { owns: r => String(r.owner_sid) === meId },
    ),
    syncCollection('fav_groups', s.favmeta.groups.map(g => ({ sid: `${meId}:${g}`, fields: { owner_sid: meId, name: g } })), { owns: r => String(r.owner_sid) === meId }),
    syncCollection(
      'visits',
      Object.entries(s.visits).flatMap(([viewed, list]) =>
        list.filter(v => v.id === meId).map(v => ({ sid: `${meId}:${viewed}:${v.at}`, fields: { viewer_sid: meId, viewed_sid: viewed, at: v.at } })),
      ),
      { owns: r => String(r.viewer_sid) === meId },
    ),
    syncCollection('blocks', s.blocks.map(t => ({ sid: `${meId}:${t}`, fields: { owner_sid: meId, target_sid: t } })), { owns: r => String(r.owner_sid) === meId }),
    syncCollection('reminders', s.reminders.map(ev => ({ sid: `${meId}:${ev}`, fields: { owner_sid: meId, event_sid: ev } })), { owns: r => String(r.owner_sid) === meId }),
    syncCollection('checkins', (s.checkins[meId] ?? []).map(ev => ({ sid: `${meId}:${ev}`, fields: { owner_sid: meId, event_sid: ev } })), { owns: r => String(r.owner_sid) === meId }),
    syncCollection(
      'contacts',
      Object.entries(s.contacts).flatMap(([ev, m]) =>
        Object.entries(m)
          .filter(([uid]) => uid === meId)
          .map(([uid, text]) => ({ sid: `${ev}:${uid}`, fields: { event_sid: ev, user_sid: uid, text } })),
      ),
      { owns: r => String(r.user_sid) === meId },
    ),
    syncCollection(
      'reports',
      s.reports.map(r => ({ sid: r.id, fields: { by_sid: r.by, target_sid: r.target, reason: r.reason, note: r.note, status: r.status ?? 'open', at: r.at } })),
      { owns: r => String(r.by_sid) === meId },
    ),
    syncCollection(
      'digests',
      s.digests.map(d => ({ sid: d.id, fields: { title: d.title, intro: d.intro, post_sids: d.postIds, cover: d.cover ?? '', covers: d.covers ?? [], issue: d.issue, at: d.at } })),
    ),
    syncCollection('admin_logs', s.adminLogs.map(l => ({ sid: l.id, fields: { text: l.text, at: l.at } }))),
    syncCollection('site_settings', [
      {
        sid: 'main',
        fields: {
          features: s.settings.features,
          stories: s.settings.stories,
          announcement: s.settings.announcement,
          hidden_events: s.settings.hiddenEvents,
          fest_templates: s.settings.festTemplates ?? {},
        },
      },
    ]),
    syncCollection('user_tour', [{ sid: meId, fields: { owner_sid: meId, data: s.tour } }], { owns: r => String(r.owner_sid) === meId }),
  ])
}

/** 精选浏览计数：走网关原子自增端点（未登录/离线时静默跳过，不影响阅读） */
export async function bumpDigestView(sid: string): Promise<void> {
  try {
    await pb.send(`/api/collections/digests/records/${encodeURIComponent(sid)}/view`, { method: 'POST' })
  } catch {
    // 忽略：下次打开会重试
  }
}

/** 私信准实时（v1.9）：只拉会话表并刷新缓存，供聊天面板打开期间轮询合并对方新消息 */
export async function refreshChats(): Promise<Record<string, ChatRow[]>> {
  const cmR = await loadCol('chat_messages')
  const chats: Record<string, ChatRow[]> = {}
  for (const r of cmR) {
    const key = [String(r.sid_a), String(r.sid_b)].sort().join(':')
    ;(chats[key] ??= []).push({
      id: r.sid,
      from: String(r.from_sid ?? ''),
      text: String(r.text ?? ''),
      at: Number(r.at ?? 0),
      recalled: !!r.recalled,
      read: Number(r.read_at ?? 0) === 1 ? true : undefined,
      images: (j(r.images, []) as string[]) ?? [],
    })
  }
  for (const k of Object.keys(chats)) chats[k].sort((a, b) => a.at - b.at)
  return chats
}

/** 修改当前登录账号密码(需校验旧密码) */
export async function changeAccountPassword(oldPassword: string, password: string): Promise<void> {
  const rec = pb.authStore.record
  if (!rec) throw new Error('not logged in')
  await pb.collection('users').update(rec.id, { oldPassword, password, passwordConfirm: password })
}

/** 掌柜专用:重置会员登录密码,返回一次性临时密码(明文仅此一次返回,不落任何日志) */
export async function adminResetPassword(userId: string): Promise<string> {
  const out = (await pb.send(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, { method: 'POST' })) as {
    tempPassword?: string
  }
  if (!out?.tempPassword) throw new Error('reset failed')
  return out.tempPassword
}

/** 服务端安全事件(v1.12):登录成败/锁定/限流/敏感词拦截/停用恢复/密码重置/删除级联等,仅掌柜可查 */
export interface SecurityEvent {
  id: string
  type: string
  actor_sid: string | null
  identity: string | null
  ip: string | null
  detail: Record<string, unknown> | null
  at: number
}

/** 掌柜专用:拉取最近安全事件(倒序) */
export async function fetchSecurityEvents(limit = 100): Promise<SecurityEvent[]> {
  const out = (await pb.send(`/api/admin/security-events?limit=${limit}`, { method: 'GET' })) as { items?: SecurityEvent[] }
  return out?.items ?? []
}

/** 掌柜专用:读敏感词表(defaults=内置底线词只读,words=自定义追加词可改) */
export async function fetchWordFilter(): Promise<{ defaults: string[]; words: string[] }> {
  const out = (await pb.send('/api/admin/word-filter', { method: 'GET' })) as { defaults?: string[]; words?: string[] }
  return { defaults: out?.defaults ?? [], words: out?.words ?? [] }
}

/** 掌柜专用:保存自定义敏感词(全量覆盖,保存即时生效) */
export async function saveWordFilter(words: string[]): Promise<string[]> {
  const out = (await pb.send('/api/admin/word-filter', { method: 'PUT', body: { words } })) as { words?: string[] }
  return out?.words ?? []
}
