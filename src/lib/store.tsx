import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { portrait } from './art'
import { districtOf } from './region'
import { getLocalAccount, onLocalAccountChange, logoutLocalAccount } from './localAuth'
import type { LocalAccount } from './localAuth'
import { loadWorld, fetchActivityStats, fetchMyVisits, fetchMyReports, fetchChatActivity, fetchProfilesByIds, fetchDiscoveryProfiles, fetchChatConversation, fetchChatSummaries, fetchRelationshipFeedback, persistRelationshipFeedback, fetchCommunityPosts, fetchCommunityDigests, fetchEventsPage, fetchEventDetail, bumpDigestView, adminResetPassword, refreshChat, persistProfile, persistLike, persistChatMessage, persistChatRecall, persistEventRegistration, persistReport, fetchEventCheckinCode, persistEventCheckin, resolveReportAdmin, submitReportAppeal, persistPost, persistPostUpdate, persistPostDelete, persistPostComment, persistPostCommentDelete, persistEventCreate, persistEventUpdate, persistEventDelete, persistEventComment, persistEventCommentPin, persistEventCommentDelete, persistAdminProfilePatch, persistContentLike, persistFavorite, persistFavoriteGroupAdd, persistFavoriteGroupRemove, persistFavoriteGroupRename, persistFavoriteGroupAssign, persistReminder, persistPass, persistRead, persistVisit, persistBlock, persistTour, persistAdminLog, persistDigestCreate, persistDigestDelete, persistSettings } from './repo'
import { DEFAULT_SETTINGS, ageOf, daysUntil, hashStr, isProfileReadyForMatching } from './store-model'
import { StoreContext } from './store-context'
import { SEED_DIGEST_IDS, SEED_EVENT_IDS, SEED_IDS, SEED_POST_IDS } from './store-seed-ids'
import type {
  ActivityStats,
  ChatMsg,
  EventItem,
  ConversationSummary,
  FavType,
  Favs,
  MatchState,
  Post,
  PostComment,
  ReportRec,
  Settings,
  Store,
  User,
  Visit,
  VisitActivity,
  WeeklyActivity,
  WeeklyDigest,
} from './store-types'
export type {
  ChatMsg,
  EventItem,
  FavType,
  Favs,
  FeatureKey,
  Gender,
  MatchState,
  Post,
  PostComment,
  ReportRec,
  Settings,
  Store,
  Story,
  User,
  Verification,
  Visit,
  WeeklyDigest,
} from './store-types'

/** 由自建账号生成会员档案。未知个人事实保持未知,由本人确认后再用于推荐。 */
function makeMember(acc: LocalAccount): User {
  return {
    id: acc.id,
    phone: '',
    password: '',
    nickname: acc.name || acc.email.split('@')[0],
    gender: 'unknown',
    seeking: 'unknown',
    birthDate: '',
    city: '',
    height: 0,
    job: '',
    bio: '',
    interests: [],
    photos: [portrait((acc.name || acc.email)[0] ?? '缘', '#8f1d2c', '#d9a05b', 'moon')],
    verification: { phone: false, realname: false, photo: false },
    createdAt: Date.now(),
  }
}

function mergeUsersById(prev: User[], incoming: User[]): User[] {
  if (!incoming.length) return prev
  const map = new Map(prev.map(user => [user.id, user]))
  let changed = false
  for (const user of incoming) {
    const old = map.get(user.id)
    if (old !== user) {
      map.set(user.id, user)
      changed = true
    }
  }
  return changed ? [...map.values()] : prev
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // 数据初始为本地种子/默认值; 登录后从数据库水合覆盖, 改动再写回数据库
  const [account, setAccount] = useState<LocalAccount | null>(() => getLocalAccount())
  const [booted, setBooted] = useState(false)
  const [dataReady, setDataReady] = useState(false)
  const [bootError, setBootError] = useState('')
  const [bootRetry, setBootRetry] = useState(0)
  const [users, setUsers] = useState<User[]>([])
  const [match, setMatch] = useState<MatchState>({ likes: {}, passes: {}, chats: {}, reads: {} })
  const [chatSummaries, setChatSummaries] = useState<Record<string, ConversationSummary>>({})
  const [activityStats, setActivityStats] = useState<ActivityStats>({ joinedEvents: 0, ownPosts: 0, lastCommentAt: 0 })
  const [posts, setPosts] = useState<Post[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [reminders, setReminders] = useState<string[]>([])
  const [favs, setFavs] = useState<Favs>({ users: [], posts: [], events: [] })
  const [favmeta, setFavmeta] = useState<{ groups: string[]; of: Record<string, string> }>({ groups: [], of: {} })
  const [composerDraft, setComposerDraftState] = useState('')
  const [composerDraftTopic, setComposerDraftTopic] = useState('')
  const [adminLogs, setAdminLogs] = useState<Array<{ id: string; at: number; text: string }>>([])
  const [visits, setVisits] = useState<Record<string, Visit[]>>({})
  const [blocks, setBlocks] = useState<string[]>([])
  const [reports, setReports] = useState<ReportRec[]>([])
  const [checkins, setCheckins] = useState<Record<string, string[]>>({})
  const [digests, setDigests] = useState<WeeklyDigest[]>([])
  const [tour, setTour] = useState<Record<string, boolean>>({})
  const [settings, setSettings] = useState<Settings>(() => structuredClone(DEFAULT_SETTINGS))
  const [contacts, setContacts] = useState<Record<string, Record<string, string>>>({})

  // 掌柜操作日志：服务端确认落库后才进入本地列表；数据库原子保留最近 100 条。
  const logOp = (text: string) => {
    const at = Date.now()
    const rec = { id: `lg${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, text }
    void persistAdminLog(rec)
      .then(() => setAdminLogs(prev => [rec, ...prev.filter(x => x.id !== rec.id)].slice(0, 100)))
      .catch(() => toast.error('操作已完成，但运营日志记录失败'))
  }

  // 订阅登录态; 退出时清空私有数据缓存
  useEffect(
    () =>
      onLocalAccountChange(a => {
        setAccount(a)
        setBooted(false)
        setDataReady(false)
        setBootError('')
        if (!a) {
          // 退出瞬间先清空真人/管理态，避免游客演示加载期间短暂暴露上一账号数据。
          setUsers([])
          setPosts([])
          setEvents([])
          setDigests([])
          setReports([])
          setAdminLogs([])
          setMatch({ likes: {}, passes: {}, chats: {}, reads: {} })
          setChatSummaries({})
          setActivityStats({ joinedEvents: 0, ownPosts: 0, lastCommentAt: 0 })
          setFavs({ users: [], posts: [], events: [] })
          setFavmeta({ groups: [], of: {} })
          setVisits({})
          setBlocks([])
          setReminders([])
          setCheckins({})
          setContacts({})
          setTour({})
        }
      }),
    [],
  )

  // 水合: 登录后只读取真实数据库；若账号尚无 profile，仅创建本人档案，绝不把演示种子灌入真人库
  useEffect(() => {
    let alive = true
    const boot = async () => {
      try {
        let world = await loadWorld(account?.id ?? null)
        if (!alive) return
        if (account && !world.users.some(u => u.id === account.id)) {
          await persistProfile(makeMember(account))
          world = await loadWorld(account.id)
        }
        if (!alive) return
        const stats = account ? await fetchActivityStats() : { joinedEvents: 0, ownPosts: 0, lastCommentAt: 0 }
        if (!alive) return
        setActivityStats(stats)
        if (account) {
          // 登录后的业务世界只保留真实数据库记录；普通会员的活动改为轻量按需加载。
          const realUsers = world.users.filter(u => !SEED_IDS.has(u.id))
          const currentUser = realUsers.find(u => u.id === account.id)
          let initialEvents = world.events.filter(e => !SEED_EVENT_IDS.has(e.id))
          if (currentUser?.role !== 'admin') {
            try {
              const mine = await fetchEventsPage({ page: 1, perPage: 36, scope: 'mine', localFirst: false })
              const map = new Map(mine.items.map(e => [e.id, e]))
              const missingReminderIds = world.reminders.filter(id => !map.has(id))
              for (let i = 0; i < missingReminderIds.length; i += 36) {
                const ids = missingReminderIds.slice(i, i + 36)
                const extra = await fetchEventsPage({ page: 1, perPage: ids.length, ids, localFirst: false })
                for (const e of extra.items) map.set(e.id, e)
              }
              initialEvents = [...map.values()]
            } catch {
              initialEvents = []
            }
          }
          if (!alive) return
          setUsers(realUsers)
          setPosts(world.posts.filter(p => !SEED_POST_IDS.has(p.id) && !SEED_IDS.has(p.authorId)))
          setEvents(initialEvents)
          setDigests(world.digests.filter(d => !SEED_DIGEST_IDS.has(d.id)))
        } else {
          // 游客才按需加载演示世界，登录用户首包不携带整套演示内容。
          const demo = await import('./store-seeds')
          if (!alive) return
          setUsers(demo.seedUsers())
          setPosts(demo.seedPosts())
          setEvents(demo.seedEvents())
          setDigests(demo.seedDigests())
        }
        if (world.settings) setSettings(world.settings)
        setReports(world.reports)
        setAdminLogs(world.adminLogs)
        if (account) {
          setMatch(world.match)
          setChatSummaries(world.chatSummaries)
          setFavs(world.favs)
          setFavmeta(world.favmeta)
          setVisits(world.visits)
          setBlocks(world.blocks)
          setReminders(world.reminders)
          setCheckins(world.checkins)
          setContacts(world.contacts)
          setTour(world.tour)
        }
        setDataReady(true)
        setBootError('')
      } catch (e) {
        if (!alive) return
        if (!account) {
          // Guest fallback is demonstration-only. Never pretend an offline database is live;
          // never seed demo profiles/posts into Neon or enable member save operations.
          try {
            const demo = await import('./store-seeds')
            if (!alive) return
            setUsers(demo.seedUsers())
            setPosts(demo.seedPosts())
            setEvents(demo.seedEvents())
            setDigests(demo.seedDigests())
          } catch { /* status banner still shows and writes stay disabled */ }
        }
        const msg = e instanceof Error ? e.message : String(e)
        const status = (e as { status?: number } | null)?.status
        setDataReady(!account)
        setBootError(msg || '数据加载失败')
        if (msg.includes('账号已停用')) {
          // 服务端封禁强制(v1.6):被停用账号的会话直接登出并告知原因
          logoutLocalAccount()
          toast.error('该账号已被停用,如有疑问请联系掌柜')
        } else if (status === 401 || msg.includes('请重新登录')) {
          // 改密/重置后旧令牌即时失效(v1.8):登出并引导重新登录
          logoutLocalAccount()
          toast.error('登录状态已失效,请重新登录')
        } else if (status === 403) {
          toast.error('部分数据无访问权限,已暂停自动保存,请联系管理员')
        } else if (!account) {
          toast.error('测试站数据服务未连接：当前仅显示演示内容，登录和聊天可能不可用')
        } else {
          toast.error('数据服务暂不可用，已暂停保存，请检查连接后重试')
        }
      }
      if (alive) setBooted(true)
    }
    void boot()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, bootRetry])

  const me = users.find(u => u.id === account?.id) ?? null

  const patchMe = (fn: (u: User) => User) => {
    setUsers(prev => prev.map(u => (u.id === account?.id ? fn(u) : u)))
  }

  const store: Store = {
    users,
    me,
    account,
    booted,
    dataReady,
    bootError,
    retryBoot() {
      setBooted(false)
      setDataReady(false)
      setBootError('')
      setBootRetry(v => v + 1)
    },
    async loadMeHistory() {
      if (!me) throw new Error('请先登录')
      const [visitRows, ownReports] = await Promise.all([fetchMyVisits(0, 500), fetchMyReports()])
      const relatedUsers = await fetchProfilesByIds([
        ...visitRows.flatMap(v => [v.viewerId, v.viewedId]),
        ...ownReports.flatMap(r => [r.target, r.by]),
      ])
      setUsers(prev => mergeUsersById(prev, relatedUsers))
      const nextVisits: Record<string, Visit[]> = {}
      for (const row of visitRows) (nextVisits[row.viewedId] ??= []).push({ id: row.viewerId, at: row.at })
      for (const list of Object.values(nextVisits)) list.sort((a, b) => b.at - a.at)
      setVisits(nextVisits)
      setReports(prev => me.role === 'admin'
        ? [...prev.filter(r => r.by !== me.id), ...ownReports].sort((a, b) => b.at - a.at)
        : ownReports)
    },
    async loadWeeklyActivity(since) {
      if (!me) throw new Error('请先登录')
      const [visitRows, messages] = await Promise.all([fetchMyVisits(since, 1000), fetchChatActivity(since)])
      const relatedUsers = await fetchProfilesByIds([
        ...visitRows.flatMap(v => [v.viewerId, v.viewedId]),
        ...messages.map(m => m.otherId),
      ])
      setUsers(prev => mergeUsersById(prev, relatedUsers))
      const result: WeeklyActivity = { visits: visitRows as VisitActivity[], messages }
      return result
    },
    async loadDiscoveryProfiles(params) {
      if (!account) throw new Error('请先登录')
      const page = await fetchDiscoveryProfiles(params)
      setUsers(prev => mergeUsersById(prev, page.items))
      return page
    },
    match,
    visits,
    activityStats,
    logout() {
      logoutLocalAccount()
    },
    async saveProfile(patch) {
      if (!me) throw new Error('请先登录')
      const next = { ...me, ...patch }
      await persistProfile(next)
      patchMe(() => next)
    },
    async addPhotos(urls) {
      if (!me) throw new Error('请先登录')
      if (!urls.length) return
      const combined = [...me.photos, ...urls].slice(0, 6)
      const firstNew = me.photos.length
      const avatar = combined[firstNew]
      const photos = avatar ? [avatar, ...combined.filter((_, i) => i !== firstNew)] : combined
      const next = { ...me, photos }
      await persistProfile(next)
      patchMe(() => next)
    },
    async removePhoto(index) {
      if (!me) throw new Error('请先登录')
      if (index < 0 || index >= me.photos.length) return
      if (me.photos.length <= 1) throw new Error('至少保留一张照片')
      const next = { ...me, photos: me.photos.filter((_, i) => i !== index) }
      await persistProfile(next)
      patchMe(() => next)
    },
    async setAvatar(index) {
      if (!me) throw new Error('请先登录')
      const target = me.photos[index]
      if (!target || index === 0) return
      const next = { ...me, photos: [target, ...me.photos.filter((_, i) => i !== index)] }
      await persistProfile(next)
      patchMe(() => next)
    },
    async reorderPhotos(from, to) {
      if (!me) throw new Error('请先登录')
      if (from === to || from < 0 || to < 0 || from >= me.photos.length || to >= me.photos.length) return
      const photos = [...me.photos]
      const [moved] = photos.splice(from, 1)
      photos.splice(to, 0, moved)
      const next = { ...me, photos }
      await persistProfile(next)
      patchMe(() => next)
    },
    likesOf: uid => match.likes[uid] ?? [],
    passesOf: uid => match.passes[uid] ?? [],
    async like(otherId) {
      if (!me) throw new Error('请先登录')
      const mine = match.likes[me.id] ?? []
      if (!mine.includes(otherId)) {
        await persistLike(me.id, otherId, true)
        setMatch(prev => ({ ...prev, likes: { ...prev.likes, [me.id]: [...(prev.likes[me.id] ?? []), otherId] } }))
      }
      // mutual 只能来自对方真实存在的反向 like 记录, 不再用哈希模拟“对方也有意”。
      return (match.likes[otherId] ?? []).includes(me.id)
    },
    async unlike(otherId) {
      if (!me) throw new Error('请先登录')
      await persistLike(me.id, otherId, false)
      setMatch(prev => ({ ...prev, likes: { ...prev.likes, [me.id]: (prev.likes[me.id] ?? []).filter(x => x !== otherId) } }))
    },
    async unpass(otherId) {
      if (!me) throw new Error('请先登录')
      await persistPass(me.id, otherId, false)
      setMatch(prev => ({ ...prev, passes: { ...prev.passes, [me.id]: (prev.passes[me.id] ?? []).filter(x => x !== otherId) } }))
    },
    async pass(otherId) {
      if (!me) throw new Error('请先登录')
      if ((match.passes[me.id] ?? []).includes(otherId)) return
      await persistPass(me.id, otherId, true)
      setMatch(prev => ({ ...prev, passes: { ...prev.passes, [me.id]: [...(prev.passes[me.id] ?? []), otherId] } }))
    },
    mutuals() {
      if (!me) return []
      const mine = match.likes[me.id] ?? []
      return users.filter(u => mine.includes(u.id) && (match.likes[u.id] ?? []).includes(me.id))
    },
    conversations() {
      if (!me) return []
      const mine = match.likes[me.id] ?? []
      const mutualIds = new Set(mine.filter(id => (match.likes[id] ?? []).includes(me.id)))
      const out: Array<{ user: User; lastAt: number; lastText: string; lastFrom: string; liked: boolean }> = []
      for (const otherId of mutualIds) {
        const u = users.find(x => x.id === otherId)
        if (!u) continue
        const summary = chatSummaries[otherId]
        out.push({
          user: u,
          lastAt: summary?.lastAt ?? 0,
          lastText: summary?.lastText ?? '',
          lastFrom: summary?.lastFrom ?? '',
          liked: true,
        })
      }
      return out.sort((x, y) => y.lastAt - x.lastAt)
    },
    unread(otherId) {
      return chatSummaries[otherId]?.unread ?? 0
    },
    async markRead(otherId) {
      if (!me) throw new Error('请先登录')
      const at = Date.now()
      await persistRead(me.id, otherId, at)
      setMatch(prev => ({ ...prev, reads: { ...prev.reads, [otherId]: at } }))
      setChatSummaries(prev => prev[otherId] ? { ...prev, [otherId]: { ...prev[otherId], unread: 0 } } : prev)
    },
    matchParts(other) {
      if (!me) return { shared: 0, sharedPts: 0, agePts: 0, cityPts: 0, districtPts: 0, verifyPts: 0 }
      const shared = me.interests.filter(i => other.interests.includes(i)).length
      const myAge = ageOf(me.birthDate)
      const otherAge = ageOf(other.birthDate)
      const diff = myAge > 0 && otherAge > 0 ? Math.abs(myAge - otherAge) : Number.POSITIVE_INFINITY
      const vf = (u: User) => u.verification.phone && u.verification.realname && u.verification.photo
      const myDistrict = districtOf(me)
      const sameDistrict = myDistrict !== '' && districtOf(other) === myDistrict && me.city === other.city
      return {
        shared,
        sharedPts: Math.min(32, shared * 8),
        agePts: diff <= 2 ? 10 : diff <= 5 ? 6 : Number.isFinite(diff) ? 2 : 0,
        cityPts: me.city && me.city === other.city ? 7 : 0,
        districtPts: sameDistrict ? 4 : 0,
        verifyPts: vf(me) && vf(other) ? 5 : 0,
      }
    },
    isMutual(otherId) {
      if (!me) return false
      return (match.likes[me.id] ?? []).includes(otherId) && (match.likes[otherId] ?? []).includes(me.id)
    },
    chatWith(otherId) {
      if (!me) return []
      return match.chats[[me.id, otherId].sort().join(':')] ?? []
    },
    async loadChat(otherId) {
      if (!me) throw new Error('请先登录')
      const key = [me.id, otherId].sort().join(':')
      const rows = await fetchChatConversation(otherId)
      setMatch(prev => ({ ...prev, chats: { ...prev.chats, [key]: rows } }))
      const last = rows[rows.length - 1]
      if (last) {
        setChatSummaries(prev => ({
          ...prev,
          [otherId]: {
            otherId,
            lastAt: last.at,
            lastText: last.recalled ? '消息已撤回' : last.text,
            lastFrom: last.from,
            unread: prev[otherId]?.unread ?? 0,
          },
        }))
      }
    },
    async sendChat(otherId, text, images) {
      if (!me) throw new Error('请先登录')
      const mutual = (match.likes[me.id] ?? []).includes(otherId) && (match.likes[otherId] ?? []).includes(me.id)
      if (!mutual) throw new Error('双方互道有意后才能发送消息')
      const key = [me.id, otherId].sort().join(':')
      const msg: ChatMsg = { id: `${Date.now()}`, from: me.id, text, at: Date.now(), images: images?.length ? images : undefined }
      await persistChatMessage(me.id, otherId, msg)
      setMatch(prev => ({ ...prev, chats: { ...prev.chats, [key]: [...(prev.chats[key] ?? []), msg] } }))
      setChatSummaries(prev => ({
        ...prev,
        [otherId]: { otherId, lastAt: msg.at, lastText: msg.text, lastFrom: me.id, unread: prev[otherId]?.unread ?? 0 },
      }))
    },
    async loadRelationshipFeedback(otherId) {
      if (!me) throw new Error('请先登录')
      return fetchRelationshipFeedback(otherId)
    },
    async setRelationshipFeedback(otherId, outcome) {
      if (!me) throw new Error('请先登录')
      return persistRelationshipFeedback(otherId, outcome)
    },
    posts,
    async loadCommunityPosts(query) {
      if (!account) throw new Error('请先登录')
      const page = await fetchCommunityPosts(query)
      const profileIds = page.items.flatMap(post => [post.authorId, ...post.comments.map(comment => comment.authorId)])
      const relatedUsers = await fetchProfilesByIds(profileIds)
      setUsers(prev => mergeUsersById(prev, relatedUsers))
      setPosts(prev => {
        const map = new Map(prev.map(p => [p.id, p]))
        for (const item of page.items) map.set(item.id, item)
        return [...map.values()]
      })
      return page
    },
    events,
    async loadEventsPage(query) {
      if (!account) throw new Error('请先登录')
      const page = await fetchEventsPage(query)
      setEvents(prev => {
        const map = new Map(prev.map(e => [e.id, e]))
        for (const item of page.items) map.set(item.id, item)
        return [...map.values()]
      })
      return page
    },
    async loadEventDetail(eventId) {
      if (!account) throw new Error('请先登录')
      const detail = await fetchEventDetail(eventId)
      const profileIds = [detail.event.creatorId ?? '', ...detail.event.attendees, ...(detail.event.comments ?? []).map(comment => comment.authorId)]
      const relatedUsers = await fetchProfilesByIds(profileIds)
      setUsers(prev => mergeUsersById(prev, relatedUsers))
      setEvents(prev => {
        const map = new Map(prev.map(e => [e.id, e]))
        map.set(detail.event.id, detail.event)
        return [...map.values()]
      })
      setContacts(prev => ({ ...prev, [eventId]: detail.contacts }))
      return detail.event
    },
    reports,
    adminLogs,
    checkins,
    async checkinEvent(eventId, code) {
      if (!me) throw new Error('请先登录')
      const ev = events.find(e => e.id === eventId)
      if (!ev || !ev.attendees.includes(me.id)) throw new Error('仅已报名成员可现场签到')
      await persistEventCheckin(eventId, code)
      setCheckins(prev => {
        const mine = prev[me.id] ?? []
        return mine.includes(eventId) ? prev : { ...prev, [me.id]: [...mine, eventId] }
      })
    },
    async getEventCheckinCode(eventId) {
      if (!me) throw new Error('请先登录')
      const out = await fetchEventCheckinCode(eventId)
      return out.code
    },
    async publish(text, images, topic) {
      if (!me) throw new Error('请先登录')
      const post: Post = { id: `pm${Date.now().toString(36)}`, authorId: me.id, text, images, topic, likes: [], comments: [], at: Date.now() }
      await persistPost(post)
      setPosts(prev => [post, ...prev])
      setActivityStats(prev => ({ ...prev, ownPosts: prev.ownPosts + 1 }))
      return post.id
    },
    async togglePostLike(postId) {
      if (!me) throw new Error('请先登录')
      const post = posts.find(p => p.id === postId)
      if (!post) throw new Error('帖子不存在或已删除')
      const active = !post.likes.includes(me.id)
      await persistContentLike('post', postId, me.id, active)
      setPosts(prev => prev.map(p => (p.id === postId ? { ...p, likes: active ? [...p.likes, me.id] : p.likes.filter(x => x !== me.id) } : p)))
      return active
    },
    async addComment(postId, text) {
      if (!me) throw new Error('请先登录')
      const post = posts.find(p => p.id === postId)
      if (!post) throw new Error('帖子不存在或已删除')
      const c: PostComment = { id: `cm${Date.now().toString(36)}`, authorId: me.id, text, at: Date.now() }
      await persistPostComment(postId, c)
      setPosts(prev => prev.map(p => (p.id === postId ? { ...p, comments: [...p.comments, c] } : p)))
      setActivityStats(prev => ({ ...prev, lastCommentAt: Math.max(prev.lastCommentAt, c.at) }))
    },
    async removeComment(postId, commentId) {
      if (!me) return false
      const p = posts.find(x => x.id === postId)
      const c = p?.comments.find(x => x.id === commentId)
      if (!p || !c || (c.authorId !== me.id && me.role !== 'admin')) return false
      await persistPostCommentDelete(commentId)
      setPosts(prev => prev.map(x => (x.id === postId ? { ...x, comments: x.comments.filter(cm => cm.id !== commentId) } : x)))
      return true
    },
    async togglePostFeatured(postId) {
      if (me?.role !== 'admin') return false
      const t = posts.find(p => p.id === postId)
      if (!t) return false
      const next = { ...t, featured: !t.featured }
      await persistPostUpdate(next)
      logOp(t.featured ? '取消了一篇精选帖' : '将一篇帖子设为精选')
      setPosts(prev => prev.map(p => (p.id === postId ? next : p)))
      return true
    },
    async removePost(postId) {
      if (me?.role !== 'admin') return false
      const t = posts.find(p => p.id === postId)
      if (!t) return false
      await persistPostDelete(postId)
      if (t.authorId === me.id) setActivityStats(prev => ({ ...prev, ownPosts: Math.max(0, prev.ownPosts - 1) }))
      logOp(`删除违规帖:${t.text.slice(0, 12)}`)
      setPosts(prev => prev.filter(p => p.id !== postId))
      setFavs(prev => ({ ...prev, posts: prev.posts.filter(x => x !== postId) }))
      return true
    },
    async editOwnPost(postId, text) {
      if (!me) throw new Error('请先登录')
      const original = posts.find(p => p.id === postId)
      if (!original || original.authorId !== me.id) return false
      const cleaned = text.trim()
      if (cleaned.length < 5 || cleaned.length > 5000) throw new Error('分享内容需要 5–5000 字')
      if (cleaned === original.text) return true
      const updated = { ...original, text: cleaned }
      await persistPostUpdate(updated)
      setPosts(prev => prev.map(p => p.id === postId ? updated : p))
      return true
    },
    async adminEditPostText(postId, text) {
      if (me?.role !== 'admin') return false
      const t = posts.find(p => p.id === postId)
      const textNext = text.trim()
      if (!t || !textNext) return false
      const next = { ...t, text: textNext }
      await persistPostUpdate(next)
      logOp(`编辑帖子文字:${textNext.slice(0, 12)}`)
      setPosts(prev => prev.map(p => (p.id === postId ? next : p)))
      return true
    },
    digests,
    async loadCommunityDigests() {
      if (!account) throw new Error('请先登录')
      setDigests(await fetchCommunityDigests())
    },
    async publishDigest(data) {
      if (me?.role !== 'admin') return false
      const title = data.title.trim()
      if (!title || !data.postIds.length) return false
      const digest: WeeklyDigest = {
        id: `dg${Date.now().toString(36)}`,
        issue: Math.max(0, ...digests.map(d => d.issue)) + 1,
        title,
        intro: data.intro.trim(),
        postIds: data.postIds,
        at: Date.now(),
        cover: data.cover || undefined,
        covers: data.covers?.length ? data.covers : undefined,
        views: 0,
      }
      await persistDigestCreate(digest)
      logOp(`发布每周精选合集「${title}」(收录 ${data.postIds.length} 篇)`)
      setDigests(prev => [digest, ...prev.filter(d => d.id !== digest.id)].slice(0, 8))
      return true
    },
    async removeDigest(id) {
      if (me?.role !== 'admin') return false
      const d = digests.find(x => x.id === id)
      if (!d) return false
      await persistDigestDelete(id)
      logOp(`撤下每周精选合集「${d.title}」`)
      setDigests(prev => prev.filter(x => x.id !== id))
      return true
    },
    async viewDigest(id) {
      try {
        await bumpDigestView(id)
        setDigests(prev => prev.map(d => (d.id === id ? { ...d, views: (d.views ?? 0) + 1 } : d)))
      } catch {
        // 阅读内容不依赖统计成功；计数失败不制造本地假数据。
      }
    },
    async joinEvent(eventId, contact) {
      if (!me) throw new Error('请先登录')
      const ev = events.find(e => e.id === eventId)
      if (!ev) throw new Error('活动不存在或已下线')
      if (ev.attendees.includes(me.id)) return
      if (ev.attendees.length >= ev.capacity) throw new Error('活动名额已满')
      await persistEventRegistration(eventId, me.id, contact?.trim() ?? '', true)
      setActivityStats(prev => ({ ...prev, joinedEvents: prev.joinedEvents + 1 }))
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, attendees: [...e.attendees, me.id] } : e)))
      setReminders(prev => (prev.includes(eventId) ? prev : [...prev, eventId]))
      if (contact?.trim()) {
        setContacts(prev => ({ ...prev, [eventId]: { ...(prev[eventId] ?? {}), [me.id]: contact.trim() } }))
      }
    },
    async leaveEvent(eventId) {
      if (!me) throw new Error('请先登录')
      const wasJoined = events.find(e => e.id === eventId)?.attendees.includes(me.id) ?? false
      await persistEventRegistration(eventId, me.id, '', false)
      if (wasJoined) setActivityStats(prev => ({ ...prev, joinedEvents: Math.max(0, prev.joinedEvents - 1) }))
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, attendees: e.attendees.filter(x => x !== me.id) } : e)))
      setReminders(prev => prev.filter(x => x !== eventId))
      setContacts(prev => {
        const next = { ...prev }
        const current = { ...(next[eventId] ?? {}) }
        delete current[me.id]
        if (Object.keys(current).length) next[eventId] = current
        else delete next[eventId]
        return next
      })
      setCheckins(prev => ({ ...prev, [me.id]: (prev[me.id] ?? []).filter(x => x !== eventId) }))
    },
    async createEvent(data) {
      if (!me) throw new Error('请先登录')
      const id = `ev${Date.now().toString(36)}`
      const ev: EventItem = { ...data, id, attendees: [me.id], host: `${me.nickname} · 会员发起`, creatorId: me.id }
      await persistEventCreate(ev, me.id)
      setActivityStats(prev => ({ ...prev, joinedEvents: prev.joinedEvents + 1 }))
      setEvents(prev => [...prev, ev])
      setReminders(prev => prev.includes(id) ? prev : [...prev, id])
      return id
    },
    async updateEvent(eventId, patch) {
      if (!me) throw new Error('请先登录')
      const target = events.find(e => e.id === eventId)
      if (!target || target.creatorId !== me.id) return false
      const rest: Partial<EventItem> = { ...patch }
      delete rest.id
      delete rest.attendees
      delete rest.creatorId
      const next = { ...target, ...rest }
      await persistEventUpdate(next)
      setEvents(prev => prev.map(e => (e.id === eventId ? next : e)))
      return true
    },
    async deleteEvent(eventId) {
      if (!me) return false
      const target = events.find(e => e.id === eventId)
      if (!target || target.creatorId !== me.id) return false
      await persistEventDelete(eventId)
      if (target.attendees.includes(me.id)) setActivityStats(prev => ({ ...prev, joinedEvents: Math.max(0, prev.joinedEvents - 1) }))
      setEvents(prev => prev.filter(e => e.id !== eventId))
      setReminders(prev => prev.filter(x => x !== eventId))
      setFavs(prev => ({ ...prev, events: prev.events.filter(x => x !== eventId) }))
      setContacts(prev => { const next = { ...prev }; delete next[eventId]; return next })
      setCheckins(prev => Object.fromEntries(Object.entries(prev).map(([uid, ids]) => [uid, ids.filter(x => x !== eventId)])))
      return true
    },
    async togglePinEvent(eventId) {
      if (!me) return false
      const target = events.find(e => e.id === eventId)
      if (!target || target.creatorId !== me.id) return false
      const next = { ...target, pinned: !target.pinned }
      await persistEventUpdate(next)
      setEvents(prev => prev.map(e => (e.id === eventId ? next : e)))
      return true
    },
    reminders,
    contacts,
    async toggleReminder(eventId) {
      if (!me) throw new Error('请先登录')
      if (!events.some(e => e.id === eventId)) throw new Error('活动不存在或已下线')
      const active = !reminders.includes(eventId)
      await persistReminder(me.id, eventId, active)
      setReminders(prev => active ? (prev.includes(eventId) ? prev : [...prev, eventId]) : prev.filter(x => x !== eventId))
      return active
    },
    upcomingReminded() {
      return reminders
        .map(id => events.find(e => e.id === id))
        .filter((e): e is EventItem => !!e)
        .map(event => ({ event, days: daysUntil(event.date) }))
        .filter(x => x.days >= 0)
        .sort((a, b) => a.days - b.days)
    },
    favs,
    async toggleFav(type, id) {
      if (!me) throw new Error('请先登录')
      const active = !favs[type].includes(id)
      await persistFavorite(me.id, type, id, favmeta.of[id] ?? '', active)
      setFavs(prev => ({ ...prev, [type]: active ? (prev[type].includes(id) ? prev[type] : [...prev[type], id]) : prev[type].filter(x => x !== id) }))
      if (!active) {
        setFavmeta(prev => {
          if (!prev.of[id]) return prev
          const of = { ...prev.of }
          delete of[id]
          return { ...prev, of }
        })
      }
      return active
    },
    isFav(type, id) {
      return favs[type].includes(id)
    },
    favGroups: favmeta.groups,
    favGroupOf(itemId) {
      return favmeta.of[itemId] ?? ''
    },
    async addFavGroup(name) {
      if (!me) throw new Error('请先登录')
      const n = name.trim()
      if (!n) return '给分组起个名字吧'
      if ([...n].length > 6) return '分组名至多 6 个字'
      if (favmeta.groups.includes(n)) return '已有同名分组'
      if (favmeta.groups.length >= 6) return '至多 6 个分组'
      await persistFavoriteGroupAdd(n)
      setFavmeta(p => ({ ...p, groups: p.groups.includes(n) ? p.groups : [...p.groups, n] }))
      return null
    },
    async removeFavGroup(name) {
      if (!me) throw new Error('请先登录')
      await persistFavoriteGroupRemove(name)
      setFavmeta(p => {
        const of: Record<string, string> = {}
        for (const [k, v] of Object.entries(p.of)) if (v !== name) of[k] = v
        return { groups: p.groups.filter(g => g !== name), of }
      })
    },
    async renameFavGroup(oldName, newName) {
      if (!me) throw new Error('请先登录')
      const n = newName.trim()
      if (!n) return '给分组起个名字吧'
      if ([...n].length > 6) return '分组名至多 6 个字'
      if (n === oldName) return null
      if (favmeta.groups.includes(n)) return '已有同名分组'
      await persistFavoriteGroupRename(oldName, n)
      setFavmeta(p => {
        const of: Record<string, string> = {}
        for (const [k, v] of Object.entries(p.of)) of[k] = v === oldName ? n : v
        return { groups: p.groups.map(g => (g === oldName ? n : g)), of }
      })
      return null
    },
    async setFavGroup(itemId, group) {
      if (!me) throw new Error('请先登录')
      const type = (['users', 'posts', 'events'] as FavType[]).find(t => favs[t].includes(itemId))
      if (!type) throw new Error('收藏记录不存在或已取消')
      if (group && !favmeta.groups.includes(group)) throw new Error('收藏分组不存在')
      await persistFavoriteGroupAssign(type, itemId, group)
      setFavmeta(p => {
        const of = { ...p.of }
        if (group) of[itemId] = group
        else delete of[itemId]
        return { ...p, of }
      })
    },
    composerDraft,
    composerDraftTopic,
    setComposerDraft(text, topic = '') {
      setComposerDraftState(text)
      setComposerDraftTopic(text ? topic : '')
    },
    async recallMsg(otherId, msgId) {
      if (!me) throw new Error('请先登录')
      const key = [me.id, otherId].sort().join(':')
      const msg = (match.chats[key] ?? []).find(m => m.id === msgId)
      if (!msg || msg.from !== me.id) throw new Error('只能撤回自己发送的消息')
      if (Date.now() - msg.at > 2 * 60_000) throw new Error('消息发送超过 2 分钟，无法撤回')
      await persistChatRecall(msgId)
      setMatch(prev => ({
        ...prev,
        chats: {
          ...prev.chats,
          [key]: (prev.chats[key] ?? []).map(m => (m.id === msgId ? { ...m, recalled: true } : m)),
        },
      }))
      setChatSummaries(prev => prev[otherId]?.lastAt === msg.at
        ? { ...prev, [otherId]: { ...prev[otherId], lastText: '消息已撤回' } }
        : prev)
    },
    async addEventComment(eventId, text) {
      if (!me) throw new Error('请先登录')
      if (!text.trim()) throw new Error('写点什么再发吧')
      if (!events.some(e => e.id === eventId)) throw new Error('活动不存在或已下线')
      const c: PostComment = { id: `ec${Date.now().toString(36)}`, authorId: me.id, text: text.trim(), at: Date.now() }
      await persistEventComment(eventId, c)
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, comments: [...(e.comments ?? []), c] } : e)))
    },
    async toggleEventCommentLike(eventId, commentId) {
      if (!me) throw new Error('请先登录')
      const comment = events.find(e => e.id === eventId)?.comments?.find(c => c.id === commentId)
      if (!comment) throw new Error('评论不存在或已删除')
      const active = !(comment.likes ?? []).includes(me.id)
      await persistContentLike('event_comment', commentId, me.id, active)
      setEvents(prev => prev.map(e => e.id !== eventId ? e : {
        ...e,
        comments: (e.comments ?? []).map(c => c.id === commentId
          ? { ...c, likes: active ? [...(c.likes ?? []), me.id] : (c.likes ?? []).filter(x => x !== me.id) }
          : c),
      }))
      return active
    },
    async toggleEventCommentPin(eventId, commentId) {
      if (!me) return false
      const ev = events.find(e => e.id === eventId)
      const comment = ev?.comments?.find(c => c.id === commentId)
      if (!ev || !comment || (ev.creatorId !== me.id && me.role !== 'admin')) return false
      const pinned = !comment.pinned
      await persistEventCommentPin(commentId, pinned)
      setEvents(prev => prev.map(e => e.id !== eventId ? e : {
        ...e,
        comments: (e.comments ?? []).map(c => c.id === commentId ? { ...c, pinned } : c),
      }))
      return true
    },
    async deleteEventComment(eventId, commentId) {
      if (!me) return false
      const ev = events.find(e => e.id === eventId)
      const c = ev?.comments?.find(x => x.id === commentId)
      if (!ev || !c || (c.authorId !== me.id && ev.creatorId !== me.id && me.role !== 'admin')) return false
      await persistEventCommentDelete(commentId)
      if (me.role === 'admin' && c.authorId !== me.id) logOp(`删除活动评论:${c.text.slice(0, 12)}`)
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, comments: (e.comments ?? []).filter(x => x.id !== commentId) } : e)))
      return true
    },
    async recordVisit(viewedId) {
      if (!me || viewedId === me.id || me.stealth) return
      const at = Date.now()
      await persistVisit(me.id, viewedId, at)
      setVisits(prev => {
        const list = (prev[viewedId] ?? []).filter(v => v.id !== me.id)
        return { ...prev, [viewedId]: [{ id: me.id, at }, ...list].slice(0, 50) }
      })
    },
    visitorsOf(uid) {
      return (visits[uid] ?? [])
        .map(v => ({ user: users.find(u => u.id === v.id), at: v.at }))
        .filter((x): x is { user: User; at: number } => !!x.user)
    },
    blocks,
    isBlocked(uid) {
      return blocks.includes(uid)
    },
    async toggleBlock(uid) {
      if (!me) throw new Error('请先登录')
      const active = !blocks.includes(uid)
      await persistBlock(me.id, uid, active)
      setBlocks(prev => active ? (prev.includes(uid) ? prev : [...prev, uid]) : prev.filter(x => x !== uid))
      return active
    },
    async reportUser(uid, reason, note) {
      if (!me) throw new Error('请先登录')
      const rec: ReportRec = { id: `rp${Date.now().toString(36)}`, by: me.id, target: uid, reason, note, at: Date.now(), status: 'open' }
      const id = await persistReport(rec)
      setReports(prev => [rec, ...prev])
      return id
    },
    async resolveReport(reportId, action) {
      if (me?.role !== 'admin') return false
      const rec = reports.find(r => r.id === reportId)
      if (!rec) return false
      const saved = await resolveReportAdmin(reportId, action)
      logOp(action === 'ban' ? '处理举报:停用了被举报账号' : '处理举报:核查后未停用账号')
      setReports(prev => prev.map(r => (r.id === reportId ? saved : r)))
      if (action === 'ban' && rec.target) {
        setUsers(prev => prev.map(u => (u.id === rec.target ? { ...u, banned: true } : u)))
      }
      return true
    },
    async appealReport(reportId, note) {
      if (!me) throw new Error('请先登录')
      const rec = reports.find(r => r.id === reportId)
      if (!rec || rec.by !== me.id) throw new Error('举报记录不存在')
      const saved = await submitReportAppeal(reportId, note)
      setReports(prev => prev.map(r => (r.id === reportId ? saved : r)))
    },
    async unbanUser(uid) {
      if (me?.role !== 'admin') return false
      const t = users.find(u => u.id === uid)
      if (!t) return false
      await persistAdminProfilePatch(uid, { banned: false })
      logOp(`恢复账号:${t.nickname}`)
      setUsers(prev => prev.map(u => (u.id === uid ? { ...u, banned: false } : u)))
      return true
    },
    async banUser(uid) {
      if (me?.role !== 'admin') return false
      const t = users.find(u => u.id === uid)
      if (!t || t.role === 'admin') return false
      await persistAdminProfilePatch(uid, { banned: true })
      logOp(`停用账号:${t.nickname}`)
      setUsers(prev => prev.map(u => (u.id === uid ? { ...u, banned: true } : u)))
      return true
    },
    async resetMemberPassword(uid) {
      if (me?.role !== 'admin') return null
      const t = users.find(u => u.id === uid)
      try {
        const temp = await adminResetPassword(uid)
        // 运营日志只记事件不记明文;明文临时密码仅在界面展示一次
        logOp(`重置会员密码:${t?.nickname ?? uid}(临时密码仅展示一次)`)
        return temp
      } catch {
        toast.error('重置未成功,请稍后再试')
        return null
      }
    },
    async refreshChatSummaries() {
      if (!me || !account) return
      const summaries = await fetchChatSummaries()
      setChatSummaries(prev => {
        const next = { ...prev }
        for (const item of summaries) {
          const old = prev[item.otherId]
          if (!old || item.lastAt >= old.lastAt) next[item.otherId] = item
        }
        return next
      })
    },
    async pollChats(otherId) {
      if (!account || !me) return
      const key = [me.id, otherId].sort().join(':')
      const rows = await refreshChat(otherId)
      setMatch(prev => {
        const old = prev.chats[key] ?? []
        const changed = old.length !== rows.length || rows.some((row, i) =>
          row.id !== old[i]?.id || row.recalled !== old[i]?.recalled || row.text !== old[i]?.text,
        )
        return changed ? { ...prev, chats: { ...prev.chats, [key]: rows } } : prev
      })
      const last = rows[rows.length - 1]
      const readAt = match.reads[otherId] ?? 0
      const unread = rows.filter(row => row.from !== me.id && row.at > readAt).length
      if (last) {
        setChatSummaries(prev => ({
          ...prev,
          [otherId]: {
            otherId,
            lastAt: last.at,
            lastText: last.recalled ? '消息已撤回' : last.text,
            lastFrom: last.from,
            unread,
          },
        }))
      }
    },
    async adminSetUserPhoto(uid, dataUrl) {
      if (me?.role !== 'admin') return false
      const t = users.find(u => u.id === uid)
      if (!t) return false
      const photos = [dataUrl, ...t.photos.slice(1)]
      await persistAdminProfilePatch(uid, { photos })
      logOp(`更换头像:${t.nickname}`)
      setUsers(prev => prev.map(u => (u.id === uid ? { ...u, photos } : u)))
      return true
    },
    async adminSetEventCover(eventId, dataUrl) {
      if (me?.role !== 'admin') return false
      const t = events.find(e => e.id === eventId)
      if (!t) return false
      const next = { ...t, cover: dataUrl }
      await persistEventUpdate(next)
      logOp(`更换活动封面:${t.title}`)
      setEvents(prev => prev.map(e => (e.id === eventId ? next : e)))
      return true
    },
    async adminSetPostImages(postId, images) {
      if (me?.role !== 'admin') return false
      const t = posts.find(p => p.id === postId)
      if (!t) return false
      const next = { ...t, images }
      await persistPostUpdate(next)
      logOp(`维护帖子图片:${t.text.slice(0, 12)}`)
      setPosts(prev => prev.map(p => (p.id === postId ? next : p)))
      return true
    },
    tour,
    async markTour(key) {
      if (!me) throw new Error('请先登录')
      if (tour[key]) return
      const next = { ...tour, [key]: true }
      await persistTour(me.id, next)
      setTour(prev => (prev[key] ? prev : { ...prev, [key]: true }))
    },
    icebreakerFor(other) {
      if (!me) return '你好,幸会。'
      const shared = me.interests.filter(t => other.interests.includes(t))
      const pool = shared.length
        ? [
            `你好,我是${me.nickname}。看到你也喜欢「${shared[0]}」,忍不住来打个招呼。`,
            `幸会。说来有缘,「${shared[0]}」也是我生活里很重要的一部分,改日交流?`,
            `你好呀,系统说我们在「${shared[0]}」上很有共鸣,我来验证一下。`,
          ]
        : [
            `你好,我是${me.nickname}。你的自述我读了两遍,很真诚,所以来了。`,
            `幸会。缘分把我推到你面前,剩下的交给我自己开口。`,
          ]
      return pool[hashStr(me.id + other.id) % pool.length]
    },
    candidates() {
      if (!me || !isProfileReadyForMatching(me)) return []
      const passed = match.passes[me.id] ?? []
      return users.filter(
        u =>
          u.id !== me.id &&
          !u.role &&
          !u.banned &&
          !SEED_IDS.has(u.id) &&
          isProfileReadyForMatching(u) &&
          u.gender === me.seeking &&
          u.seeking === me.gender &&
          !passed.includes(u.id) &&
          !blocks.includes(u.id),
      )
    },
    dailyYuanfen() {
      if (!me) return []
      const today = new Date().toISOString().slice(0, 10)
      const pool = store.candidates()
      const seed = hashStr(me.id + today)
      const sorted = [...pool].sort((a, b) => hashStr(a.id + seed) - hashStr(b.id + seed))
      return sorted.slice(0, 3)
    },
    matchScore(other) {
      if (!me) return 0
      const p = store.matchParts(other)
      const s = 50 + p.sharedPts + p.agePts + p.cityPts + p.districtPts + p.verifyPts
      return Math.max(50, Math.min(99, s))
    },
    settings,
    async saveSettings(patch) {
      if (me?.role !== 'admin') return false
      const next: Settings = {
        ...settings,
        ...patch,
        features: { ...settings.features, ...(patch.features ?? {}) },
      }
      await persistSettings(next)
      logOp('保存了站点设置(功能开关 / 活动展示 / 公告 / 佳音墙)')
      setSettings(next)
      return true
    },
    featureOn(k) {
      return settings.features[k] !== false
    },
    async toggleEventHidden(eventId) {
      if (me?.role !== 'admin') return false
      const was = settings.hiddenEvents.includes(eventId)
      const next: Settings = {
        ...settings,
        hiddenEvents: was ? settings.hiddenEvents.filter(x => x !== eventId) : [...settings.hiddenEvents, eventId],
      }
      await persistSettings(next)
      logOp(`${was ? '恢复展示活动' : '隐藏了活动'}:${events.find(e => e.id === eventId)?.title ?? eventId}`)
      setSettings(next)
      return true
    },
  }

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
