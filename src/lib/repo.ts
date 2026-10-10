import { pb } from './pb'
import type { ActivityStats, ChatActivity, ChatMsg, CommunityPostPage, CommunityPostQuery, ConversationSummary, EventDetailResult, EventItem, EventListPage, EventListQuery, Post, RelationshipFeedbackOutcome, RelationshipFeedbackState, ReportRec, Settings, User, Visit, VisitActivity, WeeklyDigest } from './store-types'

// 仓库层 v3(Repository): 一实体一表, 前端唯一允许直接碰 PocketBase/网关的地方。
// 读取由 loadWorld() 装配；写入统一走显式命令，服务端确认成功后 UI 才更新。

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
      throw new Error('数据库接口返回异常，请检查自建后端 /api 服务与网络连接')
    }
    items.push(...(res.items as unknown as Row[]))
    if (page >= res.totalPages) break
    page++
  }
  cache[col] = new Map(items.map(r => [r.sid, r]))
  return items
}

/** 核心业务命令使用可确认写入：服务端成功后才允许 UI 更新。 */
async function commandCreate(col: string, sid: string, fields: Record<string, unknown>): Promise<void> {
  const map = cache[col] ?? (cache[col] = new Map())
  if (map.has(sid)) return
  const key = JSON.stringify(fields)
  try {
    const nr = await pb.collection(col).create({ sid, ...fields })
    map.set(sid, Object.assign(nr as unknown as Row, { _key: key }))
  } catch (e) {
    // 网络超时可能发生在服务端已落库之后；重新读取确认，避免用户重试制造重复记录。
    try {
      await loadCol(col)
      if (cache[col]?.has(sid)) return
    } catch {
      // 保留原始写入错误给上层处理。
    }
    throw e
  }
}

async function commandUpsert(col: string, sid: string, fields: Record<string, unknown>): Promise<void> {
  let map = cache[col] ?? (cache[col] = new Map())
  let old = map.get(sid)
  if (!old) {
    try {
      const nr = await pb.collection(col).create({ sid, ...fields })
      map.set(sid, Object.assign(nr as unknown as Row, { _key: JSON.stringify(fields) }))
      return
    } catch (e) {
      try {
        await loadCol(col)
        map = cache[col] ?? new Map()
        old = map.get(sid)
      } catch {
        // 读取也失败时返回原始写入错误。
      }
      if (!old) throw e
    }
  }
  const nr = await pb.collection(col).update(old.id, fields)
  map.set(sid, Object.assign(nr as unknown as Row, { _key: JSON.stringify(fields) }))
}

async function commandUpdate(col: string, sid: string, fields: Record<string, unknown>): Promise<void> {
  let map = cache[col] ?? (cache[col] = new Map())
  let old = map.get(sid)
  if (!old) {
    await loadCol(col)
    map = cache[col] ?? new Map()
    old = map.get(sid)
  }
  if (!old) throw new Error('要更新的记录不存在或已被删除')
  const nr = await pb.collection(col).update(old.id, fields)
  map.set(sid, Object.assign(nr as unknown as Row, { _key: JSON.stringify(fields) }))
}

async function commandDelete(col: string, sid: string): Promise<void> {
  let map = cache[col] ?? (cache[col] = new Map())
  let old = map.get(sid)
  if (!old) {
    await loadCol(col)
    map = cache[col] ?? new Map()
    old = map.get(sid)
  }
  if (!old) return
  await pb.collection(col).delete(old.id)
  map.delete(sid)
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
  chatSummaries: Record<string, ConversationSummary>
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

function rowToUser(r: Row): User {
  return {
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
    createdAt: Number(r.created_at ?? 0),
    stealth: !!r.stealth,
    role: r.role === 'admin' ? 'admin' : undefined,
    banned: !!r.banned,
  }
}

async function fetchProfileRowsByIds(ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.map(String).map(x => x.trim()).filter(x => x && !x.startsWith('anon:')))]
  if (!unique.length) return []
  const rows: Row[] = []
  const map = cache.profiles ?? (cache.profiles = new Map())
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80)
    const qs = new URLSearchParams({ ids: chunk.join(',') })
    const out = (await pb.send(`/api/profiles/lookup?${qs.toString()}`, { method: 'GET' })) as { items?: Row[] }
    if (!Array.isArray(out.items)) throw new Error('人物资料返回异常')
    for (const row of out.items) {
      if (row?.sid) map.set(String(row.sid), row)
      rows.push(row)
    }
  }
  return rows
}

export async function fetchProfilesByIds(ids: string[]): Promise<User[]> {
  return (await fetchProfileRowsByIds(ids)).map(rowToUser)
}

export interface DiscoveryProfilesPage {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  items: User[]
}

export async function fetchDiscoveryProfiles(params: {
  page?: number
  perPage?: number
  city?: string
  district?: string
  tags?: string[]
  verifiedOnly?: boolean
  ageMin?: number
  ageMax?: number
}): Promise<DiscoveryProfilesPage> {

  const qs = new URLSearchParams()
  qs.set('page', String(params.page ?? 1))
  qs.set('perPage', String(params.perPage ?? 24))
  if (params.city) qs.set('city', params.city)
  if (params.district) qs.set('district', params.district)
  if (params.tags?.length) qs.set('tags', params.tags.join(','))
  if (params.verifiedOnly) qs.set('verified', '1')
  if (params.ageMin !== undefined) qs.set('ageMin', String(params.ageMin))
  if (params.ageMax !== undefined) qs.set('ageMax', String(params.ageMax))
  const out = (await pb.send(`/api/discovery/profiles?${qs.toString()}`, { method: 'GET' })) as {
    page?: number
    perPage?: number
    totalItems?: number
    totalPages?: number
    items?: Row[]
  }
  if (!Array.isArray(out.items)) throw new Error('人物列表返回异常')
  return {
    page: Number(out.page ?? 1),
    perPage: Number(out.perPage ?? params.perPage ?? 24),
    totalItems: Number(out.totalItems ?? out.items.length),
    totalPages: Number(out.totalPages ?? 1),
    items: out.items.map(rowToUser),
  }
}

export async function fetchCommunityPosts(query: CommunityPostQuery): Promise<CommunityPostPage> {
  const qs = new URLSearchParams()
  qs.set('page', String(query.page ?? 1))
  qs.set('perPage', String(query.perPage ?? 18))
  if (query.topic) qs.set('topic', query.topic)
  if (query.q) qs.set('q', query.q)
  if (query.sort) qs.set('sort', query.sort)
  if (query.localFirst === false) qs.set('localFirst', '0')
  if (query.ids?.length) qs.set('ids', query.ids.join(','))
  const out = (await pb.send(`/api/community/posts?${qs.toString()}`, { method: 'GET' })) as {
    page?: number
    perPage?: number
    totalItems?: number
    totalPages?: number
    items?: Array<Partial<Post> & { id?: string; comments?: Post['comments']; likes?: string[] }>
  }
  if (!Array.isArray(out.items)) throw new Error('社区列表返回异常')
  const items: Post[] = out.items.map(item => ({
    id: String(item.id ?? ''),
    authorId: String(item.authorId ?? ''),
    text: String(item.text ?? ''),
    images: Array.isArray(item.images) ? item.images.map(String) : [],
    topic: String(item.topic ?? ''),
    featured: !!item.featured,
    likes: Array.isArray(item.likes) ? item.likes.map(String) : [],
    comments: Array.isArray(item.comments) ? item.comments.map(c => ({
      id: String(c.id ?? ''),
      authorId: String(c.authorId ?? ''),
      text: String(c.text ?? ''),
      at: Number(c.at ?? 0),
      likes: Array.isArray(c.likes) ? c.likes.map(String) : [],
      pinned: !!c.pinned,
    })) : [],
    at: Number(item.at ?? 0),
  }))
  return {
    page: Number(out.page ?? query.page ?? 1),
    perPage: Number(out.perPage ?? query.perPage ?? 18),
    totalItems: Number(out.totalItems ?? items.length),
    totalPages: Number(out.totalPages ?? 1),
    items,
  }
}

export async function fetchCommunityDigests(): Promise<WeeklyDigest[]> {
  const rows = (await pb.send('/api/community/digests', { method: 'GET' })) as Row[]
  if (!Array.isArray(rows)) throw new Error('每周精选返回异常')
  return rows.map(r => ({
    id: String(r.sid ?? ''),
    issue: Number(r.issue ?? 0),
    title: String(r.title ?? ''),
    intro: String(r.intro ?? ''),
    postIds: (j(r.post_sids, []) as string[]) ?? [],
    at: Number(r.at ?? 0),
    cover: r.cover ? String(r.cover) : undefined,
    covers: (j(r.covers, []) as string[]) ?? [],
    views: Number(r.views ?? 0),
  }))
}

function normalizeEvent(item: Partial<EventItem>): EventItem {
  return {
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    city: String(item.city ?? ''),
    region: item.region ? String(item.region) : undefined,
    cover: String(item.cover ?? ''),
    date: String(item.date ?? ''),
    time: String(item.time ?? ''),
    capacity: Number(item.capacity ?? 0),
    desc: String(item.desc ?? ''),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    attendees: Array.isArray(item.attendees) ? item.attendees.map(String) : [],
    host: String(item.host ?? ''),
    creatorId: item.creatorId ? String(item.creatorId) : undefined,
    requirements: item.requirements ? String(item.requirements) : undefined,
    venue: item.venue ? String(item.venue) : undefined,
    costNote: item.costNote ? String(item.costNote) : undefined,
    cancelNote: item.cancelNote ? String(item.cancelNote) : undefined,
    pinned: !!item.pinned,
    images: Array.isArray(item.images) ? item.images.map(String) : [],
    comments: Array.isArray(item.comments) ? item.comments.map(c => ({
      id: String(c.id ?? ''),
      authorId: String(c.authorId ?? ''),
      text: String(c.text ?? ''),
      at: Number(c.at ?? 0),
      likes: Array.isArray(c.likes) ? c.likes.map(String) : [],
      pinned: !!c.pinned,
    })) : [],
  }
}

export async function fetchEventsPage(query: EventListQuery): Promise<EventListPage> {
  const qs = new URLSearchParams()
  qs.set('page', String(query.page ?? 1))
  qs.set('perPage', String(query.perPage ?? 18))
  if (query.scope) qs.set('scope', query.scope)
  if (query.ids?.length) qs.set('ids', query.ids.join(','))
  if (query.from) qs.set('from', query.from)
  if (query.to) qs.set('to', query.to)
  if (query.localFirst === false) qs.set('localFirst', '0')
  if (query.city) qs.set('city', query.city)
  const out = (await pb.send(`/api/events/list?${qs.toString()}`, { method: 'GET' })) as {
    page?: number
    perPage?: number
    totalItems?: number
    totalPages?: number
    items?: Partial<EventItem>[]
  }
  if (!Array.isArray(out.items)) throw new Error('活动列表返回异常')
  const items = out.items.map(normalizeEvent)
  return {
    page: Number(out.page ?? query.page ?? 1),
    perPage: Number(out.perPage ?? query.perPage ?? 18),
    totalItems: Number(out.totalItems ?? items.length),
    totalPages: Number(out.totalPages ?? 1),
    items,
  }
}

export async function fetchEventDetail(eventId: string): Promise<EventDetailResult> {
  const out = (await pb.send(`/api/events/${encodeURIComponent(eventId)}/detail`, { method: 'GET' })) as {
    event?: Partial<EventItem>
    contacts?: Record<string, string>
  }
  if (!out?.event?.id) throw new Error('活动详情返回异常')
  return { event: normalizeEvent(out.event), contacts: out.contacts ?? {} }
}

export async function fetchActivityStats(): Promise<ActivityStats> {
  const out = (await pb.send('/api/me/activity-stats', { method: 'GET' })) as Partial<ActivityStats>
  return {
    joinedEvents: Number(out.joinedEvents ?? 0),
    ownPosts: Number(out.ownPosts ?? 0),
    lastCommentAt: Number(out.lastCommentAt ?? 0),
  }
}

export async function fetchMyVisits(since = 0, limit = 500): Promise<VisitActivity[]> {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (since > 0) qs.set('since', String(since))
  const out = (await pb.send(`/api/me/visits?${qs.toString()}`, { method: 'GET' })) as { items?: Partial<VisitActivity>[] }
  if (!Array.isArray(out.items)) throw new Error('访问轨迹返回异常')
  return out.items.map(item => ({
    viewerId: String(item.viewerId ?? ''),
    viewedId: String(item.viewedId ?? ''),
    at: Number(item.at ?? 0),
  })).filter(item => !!item.viewerId && !!item.viewedId)
}

export async function fetchChatActivity(since: number): Promise<ChatActivity[]> {
  const qs = new URLSearchParams({ since: String(since) })
  const out = (await pb.send(`/api/me/chat-activity?${qs.toString()}`, { method: 'GET' })) as { items?: Partial<ChatActivity>[] }
  if (!Array.isArray(out.items)) throw new Error('消息活动返回异常')
  return out.items.map(item => ({
    otherId: String(item.otherId ?? ''),
    at: Number(item.at ?? 0),
    direction: (item.direction === 'sent' ? 'sent' : 'received') as ChatActivity['direction'],
  })).filter(item => !!item.otherId)
}

export async function fetchMyReports(): Promise<ReportRec[]> {
  const out = (await pb.send('/api/me/reports', { method: 'GET' })) as { items?: Row[] }
  if (!Array.isArray(out.items)) throw new Error('举报工单返回异常')
  return out.items.map(reportFromRow)
}

export async function fetchChatSummaries(): Promise<ConversationSummary[]> {
  const out = (await pb.send('/api/chats/summaries', { method: 'GET' })) as { items?: Partial<ConversationSummary>[] }
  if (!Array.isArray(out.items)) throw new Error('会话摘要返回异常')
  return out.items.map(item => ({
    otherId: String(item.otherId ?? ''),
    lastAt: Number(item.lastAt ?? 0),
    lastText: String(item.lastText ?? ''),
    lastFrom: String(item.lastFrom ?? ''),
    unread: Math.max(0, Number(item.unread ?? 0)),
  })).filter(item => !!item.otherId)
}

export async function fetchChatConversation(otherId: string): Promise<ChatMsg[]> {
  const out = (await pb.send(`/api/chats/${encodeURIComponent(otherId)}/messages`, { method: 'GET' })) as {
    items?: Array<{
      id?: string
      recordId?: string
      from?: string
      text?: string
      at?: number
      recalled?: boolean
      images?: string[]
    }>
  }
  if (!Array.isArray(out.items)) throw new Error('会话消息返回异常')
  const map = cache.chat_messages ?? (cache.chat_messages = new Map())
  const rows: ChatMsg[] = []
  for (const item of out.items) {
    const sid = String(item.id ?? '')
    if (!sid) continue
    const recordId = String(item.recordId ?? '')
    if (recordId) {
      map.set(sid, {
        id: recordId,
        sid,
        from_sid: String(item.from ?? ''),
        text: String(item.text ?? ''),
        at: Number(item.at ?? 0),
        recalled: !!item.recalled,
        images: Array.isArray(item.images) ? item.images.map(String) : [],
      })
    }
    rows.push({
      id: sid,
      from: String(item.from ?? ''),
      text: String(item.text ?? ''),
      at: Number(item.at ?? 0),
      recalled: !!item.recalled,
      images: Array.isArray(item.images) ? item.images.map(String) : [],
    })
  }
  return rows.sort((a, b) => a.at - b.at)
}

export async function fetchRelationshipFeedback(otherId: string): Promise<RelationshipFeedbackState> {
  const out = (await pb.send(`/api/me/relationship-feedback/${encodeURIComponent(otherId)}`, { method: 'GET' })) as Partial<RelationshipFeedbackState>
  return {
    available: out.available !== false,
    eligible: !!out.eligible,
    outcome: out.outcome === 'continue' || out.outcome === 'pause' ? out.outcome : null,
  }
}

export async function persistRelationshipFeedback(otherId: string, outcome: RelationshipFeedbackOutcome | null): Promise<RelationshipFeedbackState> {
  const out = (await pb.send(`/api/me/relationship-feedback/${encodeURIComponent(otherId)}`, { method: 'PUT', body: { outcome } })) as Partial<RelationshipFeedbackState>
  return {
    available: out.available !== false,
    eligible: !!out.eligible,
    outcome: out.outcome === 'continue' || out.outcome === 'pause' ? out.outcome : null,
  }
}

export async function loadWorld(meId: string | null): Promise<World> {
  const signedIn = !!meId
  // 启动只读取本人档案确认角色；普通会员不再在启动阶段全量拉 profiles。
  const initialProfiles = signedIn && meId ? await fetchProfileRowsByIds([meId]) : []
  const isAdmin = signedIn && initialProfiles.some(row => row.sid === meId && row.role === 'admin')
  const loadHeavyContent = isAdmin
  const [postsR, pcR, eventsR, ecR, csR, ulR, upR, urR, favR, fgR, visR, blR, reR, ciR, coR, rpR, dgR, ssR, tourR, clR, eaR, alR] =
    await Promise.all([
      loadCol('posts', loadHeavyContent && signedIn),
      loadCol('post_comments', loadHeavyContent && signedIn),
      loadCol('events', loadHeavyContent),
      loadCol('event_comments', loadHeavyContent),
      signedIn ? fetchChatSummaries() : Promise.resolve([] as ConversationSummary[]),
      loadCol('user_likes', signedIn),
      loadCol('user_passes', signedIn),
      loadCol('user_reads', signedIn),
      loadCol('favorites', signedIn),
      loadCol('fav_groups', signedIn),
      loadCol('visits', false),
      loadCol('blocks', signedIn),
      loadCol('reminders', signedIn),
      loadCol('checkins', signedIn),
      loadCol('contacts', false),
      loadCol('reports', isAdmin),
      loadCol('digests', loadHeavyContent),
      loadCol('site_settings'),
      loadCol('user_tour', signedIn),
      loadCol('content_likes', loadHeavyContent && signedIn),
      loadCol('event_attendees', isAdmin),
      loadCol('admin_logs', isAdmin),
    ])

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

  let profiles = isAdmin ? await loadCol('profiles') : initialProfiles
  if (signedIn && meId && !isAdmin) {
    const relatedIds = new Set<string>([meId])
    const addPair = (a: unknown, b: unknown) => {
      const sa = String(a ?? '')
      const sb = String(b ?? '')
      if (sa === meId && sb) relatedIds.add(sb)
      if (sb === meId && sa) relatedIds.add(sa)
    }
    for (const r of ulR) addPair(r.owner_sid, r.target_sid)
    for (const r of upR) addPair(r.owner_sid, r.target_sid)
    for (const summary of csR) if (summary.otherId) relatedIds.add(summary.otherId)
    for (const r of visR) addPair(r.viewer_sid, r.viewed_sid)
    for (const r of blR) addPair(r.owner_sid, r.target_sid)
    for (const r of rpR) addPair(r.by_sid, r.target_sid)
    for (const r of urR) if (String(r.owner_sid ?? '') === meId && r.other_sid) relatedIds.add(String(r.other_sid))
    for (const r of favR) if (String(r.owner_sid ?? '') === meId && String(r.fav_type ?? '') === 'users' && r.target_sid) relatedIds.add(String(r.target_sid))
    const extra = await fetchProfileRowsByIds([...relatedIds].filter(id => !initialProfiles.some(row => row.sid === id)))
    const byId = new Map([...initialProfiles, ...extra].map(row => [String(row.sid), row]))
    profiles = [...byId.values()]
  }

  const users: User[] = profiles.map(rowToUser)

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
    venue: r.venue ? String(r.venue) : undefined,
    costNote: r.cost_note ? String(r.cost_note) : undefined,
    cancelNote: r.cancel_note ? String(r.cancel_note) : undefined,
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
  const chatSummaries: Record<string, ConversationSummary> = {}
  for (const summary of csR) chatSummaries[summary.otherId] = summary
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
  for (const r of visR) {
    const viewed = String(r.viewed_sid)
    const viewer = String(r.viewer_sid)
    const at = Number(r.at ?? 0)
    const list = (visits[viewed] ??= [])
    const old = list.find(x => x.id === viewer)
    if (!old) list.push({ id: viewer, at })
    else if (at > old.at) old.at = at
  }
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
    resolution: r.resolution ? (String(r.resolution) as ReportRec['resolution']) : undefined,
    resolvedAt: Number(r.resolved_at ?? 0) || undefined,
    appealNote: r.appeal_note ? String(r.appeal_note) : undefined,
    appealAt: Number(r.appeal_at ?? 0) || undefined,
    appealStatus: r.appeal_status ? (String(r.appeal_status) as ReportRec['appealStatus']) : undefined,
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
    chatSummaries,
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

/** 保存本人资料：只写本人可编辑字段，不允许客户端借此修改核验、角色或封禁状态。 */
export async function persistProfile(user: User): Promise<void> {
  await commandUpsert('profiles', user.id, {
    nickname: user.nickname,
    gender: user.gender,
    seeking: user.seeking,
    birth_date: user.birthDate,
    city: user.city,
    region: user.region ?? '',
    height: user.height,
    job: user.job,
    bio: user.bio,
    interests: user.interests,
    photos: user.photos,
    badge_dates: user.badgeDates ?? {},
    stealth: !!user.stealth,
  })
}

export async function persistAdminLog(log: { id: string; at: number; text: string }): Promise<void> {
  await commandCreate('admin_logs', log.id, { text: log.text, at: log.at })
}

export async function persistDigestCreate(digest: WeeklyDigest): Promise<void> {
  await commandCreate('digests', digest.id, {
    title: digest.title,
    intro: digest.intro,
    post_sids: digest.postIds,
    cover: digest.cover ?? '',
    covers: digest.covers ?? [],
    issue: digest.issue,
    at: digest.at,
  })
}

export async function persistDigestDelete(id: string): Promise<void> {
  await commandDelete('digests', id)
}

export async function persistSettings(settings: Settings): Promise<void> {
  await commandUpsert('site_settings', 'main', {
    features: settings.features,
    stories: settings.stories,
    announcement: settings.announcement,
    hidden_events: settings.hiddenEvents,
    fest_templates: settings.festTemplates ?? {},
  })
}

const postFields = (post: Post) => ({
  author_sid: post.authorId,
  text: post.text,
  images: post.images,
  topic: post.topic,
  featured: !!post.featured,
  at: post.at,
})

export async function persistPost(post: Post): Promise<void> {
  await commandCreate('posts', post.id, postFields(post))
}

export async function persistPostUpdate(post: Post): Promise<void> {
  await commandUpdate('posts', post.id, postFields(post))
}

export async function persistPostDelete(postId: string): Promise<void> {
  await commandDelete('posts', postId)
}

export async function persistPostComment(postId: string, comment: { id: string; authorId: string; text: string; at: number }): Promise<void> {
  await commandCreate('post_comments', comment.id, {
    post_sid: postId,
    author_sid: comment.authorId,
    text: comment.text,
    at: comment.at,
  })
}

export async function persistPostCommentDelete(commentId: string): Promise<void> {
  await commandDelete('post_comments', commentId)
}

const eventFields = (event: EventItem) => ({
  title: event.title,
  city: event.city,
  region: event.region ?? '',
  cover: event.cover,
  date: event.date,
  time: event.time,
  capacity: event.capacity,
  desc: event.desc,
  tags: event.tags,
  host: event.host,
  creator_sid: event.creatorId ?? '',
  requirements: event.requirements ?? '',
  venue: event.venue ?? '',
  cost_note: event.costNote ?? '',
  cancel_note: event.cancelNote ?? '',
  pinned: !!event.pinned,
  images: event.images ?? [],
})

export async function persistEventCreate(event: EventItem, ownerId: string): Promise<void> {
  await commandCreate('events', event.id, eventFields(event))
  try {
    await persistEventRegistration(event.id, ownerId, '', true)
  } catch (e) {
    try { await commandDelete('events', event.id) } catch { /* 服务端级联兜底，保留原始创建错误 */ }
    throw e
  }
}

export async function persistEventUpdate(event: EventItem): Promise<void> {
  await commandUpdate('events', event.id, eventFields(event))
}

export async function persistEventDelete(eventId: string): Promise<void> {
  await commandDelete('events', eventId)
}

export async function persistEventComment(eventId: string, comment: { id: string; authorId: string; text: string; at: number }): Promise<void> {
  await commandCreate('event_comments', comment.id, {
    event_sid: eventId,
    author_sid: comment.authorId,
    text: comment.text,
    pinned: false,
    at: comment.at,
  })
}

export async function persistEventCommentPin(commentId: string, pinned: boolean): Promise<void> {
  await commandUpdate('event_comments', commentId, { pinned })
}

export async function persistEventCommentDelete(commentId: string): Promise<void> {
  await commandDelete('event_comments', commentId)
}

export async function persistAdminProfilePatch(userId: string, patch: { banned?: boolean; photos?: string[] }): Promise<void> {
  await commandUpdate('profiles', userId, patch)
}

/** 本人真实表达/撤回「有意」。 */
export async function persistLike(ownerId: string, targetId: string, active: boolean): Promise<void> {
  const sid = `${ownerId}:${targetId}`
  if (active) await commandCreate('user_likes', sid, { owner_sid: ownerId, target_sid: targetId })
  else await commandDelete('user_likes', sid)
}

export async function persistContentLike(kind: 'post' | 'post_comment' | 'event_comment', targetId: string, ownerId: string, active: boolean): Promise<void> {
  const sid = `${kind}:${targetId}:${ownerId}`
  if (active) await commandCreate('content_likes', sid, { kind, target_sid: targetId, owner_sid: ownerId })
  else await commandDelete('content_likes', sid)
}

export async function persistFavorite(ownerId: string, type: 'users' | 'posts' | 'events', targetId: string, groupName: string, active: boolean): Promise<void> {
  const sid = `${ownerId}:${type}:${targetId}`
  if (active) {
    await commandCreate('favorites', sid, { owner_sid: ownerId, fav_type: type, target_sid: targetId, group_name: groupName })
  } else {
    await commandDelete('favorites', sid)
  }
}

async function favoriteGroupAction(body: Record<string, unknown>): Promise<void> {
  const out = (await pb.send('/api/favorites/groups', { method: 'POST', body })) as { ok?: boolean }
  if (!out?.ok) throw new Error('收藏分组操作未保存')
  // 服务端可能同时改 fav_groups 与多条 favorites，完成后刷新两张缓存，避免后续命令使用旧 sid/group_name。
  await Promise.all([loadCol('favorites'), loadCol('fav_groups')])
}

export async function persistFavoriteGroupAdd(name: string): Promise<void> {
  await favoriteGroupAction({ action: 'add', name })
}

export async function persistFavoriteGroupRemove(name: string): Promise<void> {
  await favoriteGroupAction({ action: 'remove', name })
}

export async function persistFavoriteGroupRename(name: string, newName: string): Promise<void> {
  await favoriteGroupAction({ action: 'rename', name, newName })
}

export async function persistFavoriteGroupAssign(type: 'users' | 'posts' | 'events', targetId: string, group: string): Promise<void> {
  await favoriteGroupAction({ action: 'assign', type, targetId, group })
}

export async function persistReminder(ownerId: string, eventId: string, active: boolean): Promise<void> {
  const sid = `${ownerId}:${eventId}`
  if (active) await commandCreate('reminders', sid, { owner_sid: ownerId, event_sid: eventId })
  else await commandDelete('reminders', sid)
}

export async function persistPass(ownerId: string, targetId: string, active: boolean): Promise<void> {
  const sid = `${ownerId}:${targetId}`
  if (active) await commandCreate('user_passes', sid, { owner_sid: ownerId, target_sid: targetId })
  else await commandDelete('user_passes', sid)
}

export async function persistRead(ownerId: string, otherId: string, at: number): Promise<void> {
  await commandUpsert('user_reads', `${ownerId}:${otherId}`, { owner_sid: ownerId, other_sid: otherId, at })
}

export async function persistVisit(viewerId: string, viewedId: string, at: number): Promise<void> {
  await commandUpsert('visits', `${viewerId}:${viewedId}`, { viewer_sid: viewerId, viewed_sid: viewedId, at })
}

export async function persistBlock(ownerId: string, targetId: string, active: boolean): Promise<void> {
  const sid = `${ownerId}:${targetId}`
  if (active) await commandCreate('blocks', sid, { owner_sid: ownerId, target_sid: targetId })
  else await commandDelete('blocks', sid)
}

export async function persistTour(ownerId: string, data: Record<string, boolean>): Promise<void> {
  await commandUpsert('user_tour', ownerId, { owner_sid: ownerId, data })
}

/** 真人消息：服务端还会再次校验发送者、mutual 与拉黑关系。 */
export async function persistChatMessage(
  ownerId: string,
  otherId: string,
  msg: { id: string; text: string; at: number; images?: string[] },
): Promise<void> {
  const [sidA, sidB] = [ownerId, otherId].sort()
  await commandCreate('chat_messages', msg.id, {
    sid_a: sidA,
    sid_b: sidB,
    from_sid: ownerId,
    text: msg.text,
    images: msg.images ?? [],
    recalled: false,
    read_at: 0,
    at: msg.at,
  })
}

export async function persistChatRecall(msgId: string): Promise<void> {
  await commandUpdate('chat_messages', msgId, { recalled: true })
}

/** 报名/取消作为一组可重试命令；取消时同时清理提醒、联系方式和旧签到。 */
export async function persistEventRegistration(eventId: string, ownerId: string, contact: string, active: boolean): Promise<void> {
  const attendeeSid = `${eventId}:${ownerId}`
  const privateSid = `${ownerId}:${eventId}`
  const contactSid = `${eventId}:${ownerId}`
  if (active) {
    await commandCreate('event_attendees', attendeeSid, { event_sid: eventId, owner_sid: ownerId })
    await commandCreate('reminders', privateSid, { owner_sid: ownerId, event_sid: eventId })
    if (contact.trim()) await commandUpsert('contacts', contactSid, { event_sid: eventId, user_sid: ownerId, text: contact.trim() })
    return
  }
  await Promise.all([
    commandDelete('event_attendees', attendeeSid),
    commandDelete('reminders', privateSid),
    commandDelete('contacts', contactSid),
    commandDelete('checkins', privateSid),
  ])
}

export async function fetchEventCheckinCode(eventId: string): Promise<{ code: string; opensAt?: string; closesAt?: string }> {
  const out = (await pb.send(`/api/events/${encodeURIComponent(eventId)}/checkin-code`, { method: 'GET' })) as {
    code?: string
    opensAt?: string
    closesAt?: string
  }
  if (!out?.code) throw new Error('签到码暂不可用')
  return { code: out.code, opensAt: out.opensAt, closesAt: out.closesAt }
}

export async function persistEventCheckin(eventId: string, code: string): Promise<void> {
  const out = (await pb.send(`/api/events/${encodeURIComponent(eventId)}/checkin`, { method: 'POST', body: { code } })) as {
    checkedIn?: boolean
    record?: Row
  }
  if (!out?.checkedIn) throw new Error('签到未完成')
  if (out.record?.sid && out.record?.id) {
    const map = cache.checkins ?? (cache.checkins = new Map())
    map.set(String(out.record.sid), Object.assign(out.record, { _key: JSON.stringify(out.record) }))
  }
}

/** 举报成功以服务端落库为准，返回受理编号供界面展示。 */
export async function persistReport(rec: ReportRec): Promise<string> {
  await commandCreate('reports', rec.id, {
    by_sid: rec.by,
    target_sid: rec.target,
    reason: rec.reason,
    note: rec.note,
    status: rec.status ?? 'open',
    at: rec.at,
  })
  return rec.id
}

function reportFromRow(r: Row): ReportRec {
  return {
    id: String(r.sid ?? ''),
    by: String(r.by_sid ?? ''),
    target: String(r.target_sid ?? ''),
    reason: String(r.reason ?? ''),
    note: String(r.note ?? ''),
    at: Number(r.at ?? 0),
    status: (String(r.status ?? 'open') as ReportRec['status']),
    resolution: r.resolution ? (String(r.resolution) as ReportRec['resolution']) : undefined,
    resolvedAt: Number(r.resolved_at ?? 0) || undefined,
    appealNote: r.appeal_note ? String(r.appeal_note) : undefined,
    appealAt: Number(r.appeal_at ?? 0) || undefined,
    appealStatus: r.appeal_status ? (String(r.appeal_status) as ReportRec['appealStatus']) : undefined,
  }
}

export async function resolveReportAdmin(reportId: string, action: 'ban' | 'dismiss'): Promise<ReportRec> {
  const row = (await pb.send(`/api/admin/reports/${encodeURIComponent(reportId)}/resolve`, { method: 'POST', body: { action } })) as Row
  if (!row?.sid) throw new Error('举报处理未保存')
  const map = cache.reports ?? (cache.reports = new Map())
  map.set(String(row.sid), Object.assign(row, { _key: JSON.stringify(row) }))
  return reportFromRow(row)
}

export async function submitReportAppeal(reportId: string, note: string): Promise<ReportRec> {
  const row = (await pb.send(`/api/reports/${encodeURIComponent(reportId)}/appeal`, { method: 'POST', body: { note } })) as Row
  if (!row?.sid) throw new Error('申诉未保存')
  const map = cache.reports ?? (cache.reports = new Map())
  map.set(String(row.sid), Object.assign(row, { _key: JSON.stringify(row) }))
  return reportFromRow(row)
}

/** 精选浏览计数：走网关原子自增端点（未登录/离线时静默跳过，不影响阅读） */
export async function bumpDigestView(sid: string): Promise<void> {
  await pb.send(`/api/collections/digests/records/${encodeURIComponent(sid)}/view`, { method: 'POST' })
}

/** 单个打开会话准实时刷新：不再轮询整张 chat_messages。 */
export async function refreshChat(otherId: string): Promise<ChatMsg[]> {
  return fetchChatConversation(otherId)
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

export interface PilotMetrics {
  available: boolean
  days: number
  reason?: string
  supply: { eligibleProfiles: number; byCity: Array<{ city: string; count: number }> }
  exposure: {
    deliveries: number
    viewers: number
    targets: number
    coverageRate: number
    top10Share: number
    maxPerTarget: number
    sources: Array<{ source: string; count: number }>
  }
  funnel: { likes: number; mutualPairs: number; conversations: number; twoWayConversations: number; messages: number; eventJoins: number; eventCheckins: number; feedbackContinue: number; feedbackPause: number }
}

/** 掌柜专用：真实试点的最小化聚合指标；不返回任何逐人曝光明细。 */
export async function fetchPilotMetrics(days = 7): Promise<PilotMetrics> {
  const safeDays = Math.min(30, Math.max(1, Math.round(days) || 7))
  const out = (await pb.send(`/api/admin/pilot-metrics?days=${safeDays}`, { method: 'GET' })) as Partial<PilotMetrics>
  if (out.available === false) {
    return {
      available: false,
      days: Number(out.days ?? safeDays),
      reason: String(out.reason ?? 'unavailable'),
      supply: { eligibleProfiles: 0, byCity: [] },
      exposure: { deliveries: 0, viewers: 0, targets: 0, coverageRate: 0, top10Share: 0, maxPerTarget: 0, sources: [] },
      funnel: { likes: 0, mutualPairs: 0, conversations: 0, twoWayConversations: 0, messages: 0, eventJoins: 0, eventCheckins: 0, feedbackContinue: 0, feedbackPause: 0 },
    }
  }
  return {
    available: true,
    days: Number(out.days ?? safeDays),
    supply: {
      eligibleProfiles: Number(out.supply?.eligibleProfiles ?? 0),
      byCity: Array.isArray(out.supply?.byCity) ? out.supply.byCity.map(x => ({ city: String(x.city ?? ''), count: Number(x.count ?? 0) })) : [],
    },
    exposure: {
      deliveries: Number(out.exposure?.deliveries ?? 0),
      viewers: Number(out.exposure?.viewers ?? 0),
      targets: Number(out.exposure?.targets ?? 0),
      coverageRate: Number(out.exposure?.coverageRate ?? 0),
      top10Share: Number(out.exposure?.top10Share ?? 0),
      maxPerTarget: Number(out.exposure?.maxPerTarget ?? 0),
      sources: Array.isArray(out.exposure?.sources) ? out.exposure.sources.map(x => ({ source: String(x.source ?? ''), count: Number(x.count ?? 0) })) : [],
    },
    funnel: {
      likes: Number(out.funnel?.likes ?? 0),
      mutualPairs: Number(out.funnel?.mutualPairs ?? 0),
      conversations: Number(out.funnel?.conversations ?? 0),
      twoWayConversations: Number(out.funnel?.twoWayConversations ?? 0),
      messages: Number(out.funnel?.messages ?? 0),
      eventJoins: Number(out.funnel?.eventJoins ?? 0),
      eventCheckins: Number(out.funnel?.eventCheckins ?? 0),
      feedbackContinue: Number(out.funnel?.feedbackContinue ?? 0),
      feedbackPause: Number(out.funnel?.feedbackPause ?? 0),
    },
  }
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
