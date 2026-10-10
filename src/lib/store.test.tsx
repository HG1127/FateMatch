// @vitest-environment jsdom
import { act, cleanup, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from 'sonner'
import type { ReactNode } from 'react'
import { pb } from './pb'
import { StoreProvider } from './store'
import { useStore } from './store-context'
import type { User } from './store'
import { isProfileReadyForMatching } from './store-model'

function signIn(id: string) {
  const token = `test.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`
  pb.authStore.save(token, { id, collectionId: 'users', collectionName: 'users', email: `${id}@example.test`, name: id })
}

function wrapper({ children }: { children: ReactNode }) {
  return <><StoreProvider>{children}</StoreProvider><Toaster /></>
}

function serveStore(data?: {
  profiles?: Record<string, unknown>[]
  likes?: Record<string, unknown>[]
  posts?: Record<string, unknown>[]
  events?: Record<string, unknown>[]
  contentLikes?: Record<string, unknown>[]
  reminders?: Record<string, unknown>[]
  passes?: Record<string, unknown>[]
  reads?: Record<string, unknown>[]
  chats?: Record<string, unknown>[]
  blocks?: Record<string, unknown>[]
  visits?: Record<string, unknown>[]
  reports?: Record<string, unknown>[]
  favorites?: Record<string, unknown>[]
  favGroups?: Record<string, unknown>[]
  digests?: Record<string, unknown>[]
}) {
  const writes: string[] = []
  const profileRows = [...(data?.profiles ?? [{ id: 'p1', sid: 'member-a', nickname: '远端会员', role: '' }])]
  let failStatus = 0
  let failSettingsStatus = 0
  let failWriteStatus = 0
  let pending: Promise<Response> | null = null
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (method === 'GET' && url.pathname.endsWith('/api/chats/summaries')) {
      const meId = String(pb.authStore.record?.id ?? '')
      const readAtByOther = new Map<string, number>()
      for (const row of data?.reads ?? []) {
        if (String(row.owner_sid ?? '') === meId) readAtByOther.set(String(row.other_sid ?? ''), Number(row.at ?? 0))
      }
      const grouped = new Map<string, Record<string, unknown>[]>()
      for (const row of data?.chats ?? []) {
        const a = String(row.sid_a ?? '')
        const b = String(row.sid_b ?? '')
        if (a !== meId && b !== meId) continue
        const otherId = a === meId ? b : a
        const list = grouped.get(otherId) ?? []
        list.push(row)
        grouped.set(otherId, list)
      }
      const items = [...grouped.entries()].map(([otherId, rows]) => {
        const sorted = [...rows].sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0))
        const last = sorted[sorted.length - 1] ?? {}
        const readAt = readAtByOther.get(otherId) ?? 0
        return {
          otherId,
          lastAt: Number(last.at ?? 0),
          lastText: last.recalled ? '消息已撤回' : String(last.text ?? ''),
          lastFrom: String(last.from_sid ?? ''),
          unread: sorted.filter(row => String(row.from_sid ?? '') !== meId && Number(row.at ?? 0) > readAt).length,
        }
      })
      return Response.json({ items })
    }
    const chatMatch = url.pathname.match(/\/api\/chats\/([^/]+)\/messages$/)
    if (method === 'GET' && chatMatch) {
      const meId = String(pb.authStore.record?.id ?? '')
      const otherId = decodeURIComponent(chatMatch[1])
      const items = (data?.chats ?? [])
        .filter(row => {
          const a = String(row.sid_a ?? '')
          const b = String(row.sid_b ?? '')
          return (a === meId && b === otherId) || (a === otherId && b === meId)
        })
        .sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0))
        .map(row => ({
          id: String(row.sid ?? ''),
          recordId: String(row.id ?? ''),
          from: String(row.from_sid ?? ''),
          text: String(row.text ?? ''),
          at: Number(row.at ?? 0),
          recalled: !!row.recalled,
          images: Array.isArray(row.images) ? row.images : [],
        }))
      return Response.json({ items })
    }
    if (method === 'GET' && url.pathname.endsWith('/api/profiles/lookup')) {
      if (pending) return pending
      if (failStatus) return Response.json({ message: 'Read failed', data: {} }, { status: failStatus })
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
      return Response.json({ items: profileRows.filter(row => ids.includes(String(row.sid ?? ''))) })
    }
    if (method === 'GET' && url.pathname.endsWith('/api/discovery/profiles')) {
      const meId = String(pb.authStore.record?.id ?? '')
      const items = profileRows.filter(row => String(row.sid ?? '') !== meId)
      return Response.json({ page: 1, perPage: Math.max(1, items.length), totalPages: items.length ? 1 : 0, totalItems: items.length, items })
    }
    if (method === 'GET' && url.pathname.endsWith('/api/me/activity-stats')) {
      return Response.json({ joinedEvents: 0, ownPosts: 0, lastCommentAt: 0 })
    }
    if (method === 'GET' && url.pathname.endsWith('/api/me/visits')) {
      const meId = String(pb.authStore.record?.id ?? '')
      const since = Number(url.searchParams.get('since') ?? 0)
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 500) || 500))
      const latest = new Map<string, Record<string, unknown>>()
      for (const row of data?.visits ?? []) {
        const viewerId = String(row.viewer_sid ?? '')
        const viewedId = String(row.viewed_sid ?? '')
        const at = Number(row.at ?? 0)
        if ((viewerId !== meId && viewedId !== meId) || at < since) continue
        const key = `${viewerId}:${viewedId}`
        const old = latest.get(key)
        if (!old || at > Number(old.at ?? 0)) latest.set(key, row)
      }
      const items = [...latest.values()]
        .sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0))
        .slice(0, limit)
        .map(row => ({ viewerId: String(row.viewer_sid ?? ''), viewedId: String(row.viewed_sid ?? ''), at: Number(row.at ?? 0) }))
      return Response.json({ items })
    }
    if (method === 'GET' && url.pathname.endsWith('/api/me/reports')) {
      const meId = String(pb.authStore.record?.id ?? '')
      const items = (data?.reports ?? [])
        .filter(row => String(row.by_sid ?? '') === meId)
        .sort((a, b) => Number(b.at ?? 0) - Number(a.at ?? 0))
      return Response.json({ items })
    }
    if (method === 'GET' && url.pathname.endsWith('/api/me/chat-activity')) {
      const meId = String(pb.authStore.record?.id ?? '')
      const since = Number(url.searchParams.get('since') ?? 0)
      const items = (data?.chats ?? [])
        .filter(row => {
          const a = String(row.sid_a ?? '')
          const b = String(row.sid_b ?? '')
          return (a === meId || b === meId) && Number(row.at ?? 0) >= since
        })
        .sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0))
        .map(row => {
          const a = String(row.sid_a ?? '')
          const b = String(row.sid_b ?? '')
          return {
            otherId: a === meId ? b : a,
            at: Number(row.at ?? 0),
            direction: String(row.from_sid ?? '') === meId ? 'sent' : 'received',
          }
        })
      return Response.json({ items })
    }
    if (method === 'GET' && url.pathname.endsWith('/api/community/posts')) {
      const likesByPost = new Map<string, string[]>()
      for (const row of data?.contentLikes ?? []) {
        if (row.kind !== 'post') continue
        const postId = String(row.target_sid ?? '')
        const ownerId = String(row.owner_sid ?? '')
        if (!postId || !ownerId) continue
        const current = likesByPost.get(postId) ?? []
        current.push(ownerId)
        likesByPost.set(postId, current)
      }
      const items = (data?.posts ?? []).map(row => ({
        id: String(row.sid ?? ''),
        authorId: String(row.author_sid ?? ''),
        text: String(row.text ?? ''),
        images: Array.isArray(row.images) ? row.images : [],
        topic: String(row.topic ?? ''),
        featured: !!row.featured,
        likes: likesByPost.get(String(row.sid ?? '')) ?? [],
        comments: [],
        at: Number(row.at ?? 0),
      }))
      return Response.json({ page: 1, perPage: Math.max(1, items.length), totalPages: items.length ? 1 : 0, totalItems: items.length, items })
    }
    if (method === 'GET' && url.pathname.endsWith('/api/community/digests')) {
      return Response.json((data?.digests ?? []).map(row => ({ ...row })))
    }
    if (method === 'GET' && url.pathname.endsWith('/api/events/list')) {
      const items = (data?.events ?? []).map(row => ({
        id: String(row.sid ?? ''),
        title: String(row.title ?? ''),
        city: String(row.city ?? ''),
        region: row.region ? String(row.region) : undefined,
        cover: String(row.cover ?? ''),
        date: String(row.date ?? ''),
        time: String(row.time ?? ''),
        capacity: Number(row.capacity ?? 0),
        desc: String(row.desc ?? ''),
        tags: Array.isArray(row.tags) ? row.tags : [],
        attendees: [],
        host: String(row.host ?? ''),
        creatorId: row.creator_sid ? String(row.creator_sid) : undefined,
        pinned: !!row.pinned,
        images: Array.isArray(row.images) ? row.images : [],
        comments: [],
      }))
      return Response.json({ page: 1, perPage: Math.max(1, items.length), totalPages: items.length ? 1 : 0, totalItems: items.length, items })
    }
    // 标准同源路径：/api/collections/{name}/records
    const collection = url.pathname.split('/')[3]
    if (method !== 'GET') {
      writes.push(`${method} ${url.pathname}`)
      if (failWriteStatus) return Response.json({ message: 'Write failed', data: {} }, { status: failWriteStatus })
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      const record = { id: 'written', ...body }
      if (collection === 'profiles' && method === 'POST') profileRows.push(record)
      return Response.json(record)
    }
    if (collection === 'profiles' && pending) return pending
    if (collection === 'site_settings' && failSettingsStatus) return Response.json({ message: 'Service temporarily unavailable' }, { status: failSettingsStatus })
    if (collection === 'profiles' && failStatus) return Response.json({ message: 'Read failed', data: {} }, { status: failStatus })
    const items = collection === 'profiles'
      ? profileRows
      : collection === 'user_likes'
        ? (data?.likes ?? [])
        : collection === 'posts'
          ? (data?.posts ?? [])
          : collection === 'events'
            ? (data?.events ?? [])
            : collection === 'content_likes'
              ? (data?.contentLikes ?? [])
              : collection === 'reminders'
                ? (data?.reminders ?? [])
                : collection === 'user_passes'
                  ? (data?.passes ?? [])
                  : collection === 'user_reads'
                    ? (data?.reads ?? [])
                    : collection === 'chat_messages'
                      ? (data?.chats ?? [])
                      : collection === 'blocks'
                        ? (data?.blocks ?? [])
                        : collection === 'visits'
                          ? (data?.visits ?? [])
                          : collection === 'favorites'
                            ? (data?.favorites ?? [])
                            : collection === 'fav_groups'
                              ? (data?.favGroups ?? [])
                              : collection === 'digests'
                                ? (data?.digests ?? [])
                                : []
    return Response.json({ page: 1, perPage: 200, totalPages: items.length ? 1 : 0, totalItems: items.length, items })
  })
  return {
    writes,
    fail: (status: number) => { failStatus = status },
    failSettings: (status: number) => { failSettingsStatus = status },
    failWrite: (status: number) => { failWriteStatus = status },
    defer: (response: Promise<Response>) => { pending = response },
  }
}

const readyProfile = (patch: Partial<User> = {}): User => ({
  id: 'member-a',
  phone: '',
  password: '',
  nickname: '会员',
  gender: 'female',
  seeking: 'male',
  birthDate: '1990-01-01',
  city: '深圳',
  height: 165,
  job: '',
  bio: '',
  interests: ['阅读', '徒步', '摄影'],
  photos: [],
  verification: { phone: false, realname: false, photo: false },
  createdAt: 0,
  ...patch,
})

beforeEach(() => {
  vi.useFakeTimers()
  pb.authStore.clear()
})

afterEach(() => {
  cleanup()
  pb.authStore.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

describe('初始化完成前禁止自动保存', () => {
  it.each([403, 500])('读取失败 %s 后结束加载，但不将临时数据写回', async status => {
    const api = serveStore()
    api.fail(status)
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.booted).toBe(true)
    expect(result.current.dataReady).toBe(false)
    expect(result.current.bootError).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.writes).toEqual([])
    expect(screen.queryByText(/数据库连接失败/)).toBeNull()
    if (status === 403) expect(screen.getByText(/权限/)).toBeTruthy()
  })

  it('游客启动时 API 暂时失败：显示演示数据与可重试状态，不写入任何数据库', async () => {
    const api = serveStore()
    api.failSettings(500)
    // Preload async visitor demo module so React's effect can finish deterministically.
    await import('./store-seeds')
    const { result } = renderHook(useStore, { wrapper })
    for (let i = 0; i < 5 && !result.current.booted; i++) await settle()
    expect(result.current.booted).toBe(true)
    expect(result.current.dataReady).toBe(true)
    expect(result.current.bootError).toBeTruthy()
    expect(result.current.account).toBeNull()
    expect(result.current.users.length).toBeGreaterThan(0)
    expect(api.writes).toEqual([])
    api.failSettings(0)
    act(() => result.current.retryBoot())
    await settle()
    expect(result.current.bootError).toBe('')
    expect(api.writes).toEqual([])
  })

  it('新账号只创建本人 profile，不把演示世界灌入真人数据库', async () => {
    const api = serveStore({ profiles: [] })
    signIn('member-new')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.booted).toBe(true)
    expect(result.current.dataReady).toBe(true)
    expect(result.current.me?.id).toBe('member-new')
    expect(result.current.me?.gender).toBe('unknown')
    const created = api.writes.filter(x => x.startsWith('POST '))
    expect(created).toEqual(['POST /api/collections/profiles/records'])
    expect(api.writes.some(x => /\/(posts|events|digests|site_settings)\/records/.test(x))).toBe(false)
  })

  it('成功加载后不自动写主表，明确保存资料时才 PATCH', async () => {
    const api = serveStore()
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.me?.nickname).toBe('远端会员')
    expect(result.current.dataReady).toBe(true)
    expect(result.current.bootError).toBe('')
    expect(api.writes).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.writes).toEqual([])
    await act(async () => { await result.current.saveProfile({ nickname: '远端会员已更新' }) })
    expect(api.writes).toContain('PATCH /api/collections/profiles/records/p1')
    expect(result.current.me?.nickname).toBe('远端会员已更新')
  })

  it('读取失败后可重试并恢复可信数据状态', async () => {
    const api = serveStore()
    api.fail(500)
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.dataReady).toBe(false)
    api.fail(0)
    act(() => result.current.retryBoot())
    await settle()
    expect(result.current.booted).toBe(true)
    expect(result.current.dataReady).toBe(true)
    expect(result.current.bootError).toBe('')
    expect(result.current.me?.nickname).toBe('远端会员')
  })

  it('切换账号后，旧状态不能在新账号尚未加载时写回', async () => {
    const api = serveStore()
    signIn('member-a')
    renderHook(useStore, { wrapper })
    await settle()
    api.defer(new Promise(() => {}))
    act(() => signIn('member-b'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.writes).toEqual([])
  })

  it('退出后立即清空真人态，过期加载也不能触发演示数据写回', async () => {
    const api = serveStore({
      posts: [{ id: 'post-row', sid: 'post-real', author_sid: 'member-a', text: '真人帖子', images: [], topic: '慢生活', at: 1 }],
      events: [{ id: 'event-row', sid: 'event-real', title: '真人活动', city: '深圳', cover: '', date: '2026-10-10', time: '14:00', capacity: 12, desc: '', tags: [], host: '测试', creator_sid: 'member-a' }],
      digests: [{ id: 'digest-row', sid: 'digest-real', issue: 2, title: '真人精选', intro: '', post_sids: ['post-real'], covers: [], at: 1, views: 0 }],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.users.some(u => u.id === 'member-a')).toBe(true)
    await act(async () => {
      await result.current.loadCommunityPosts({ page: 1, perPage: 18 })
      await result.current.loadCommunityDigests()
    })
    expect(result.current.posts.some(post => post.id === 'post-real')).toBe(true)
    expect(result.current.events.some(event => event.id === 'event-real')).toBe(true)
    expect(result.current.digests.some(digest => digest.id === 'digest-real')).toBe(true)

    let finish!: (response: Response) => void
    api.defer(new Promise(resolve => { finish = resolve }))
    act(() => pb.authStore.clear())
    expect(result.current.account).toBeNull()
    expect(result.current.users).toEqual([])
    expect(result.current.posts).toEqual([])
    expect(result.current.events).toEqual([])
    expect(result.current.digests).toEqual([])

    finish(Response.json({ page: 1, perPage: 200, totalPages: 0, totalItems: 0, items: [] }))
    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.writes).toEqual([])
  })
})

describe('确认式内容与活动写入', () => {
  it('本人可编辑自己的分享，失败不覆盖旧内容，禁止编辑他人分享', async () => {
    const api = serveStore({ posts: [
      { id: 'own-row', sid: 'own-post', author_sid: 'member-a', text: '原来的真实分享', images: [], topic: '认识我', at: 100 },
      { id: 'other-row', sid: 'other-post', author_sid: 'member-b', text: '其他人的真实分享', images: [], topic: '认识我', at: 101 },
    ] })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    await act(async () => { await result.current.loadCommunityPosts({ page: 1, perPage: 18 }) })
    expect(result.current.posts.find(x => x.id === 'own-post')?.text).toBe('原来的真实分享')
    await act(async () => {
      expect(await result.current.editOwnPost('other-post', '无权修改他人内容')).toBe(false)
    })
    expect(api.writes).toHaveLength(0)
    api.failWrite(500)
    let failed = false
    await act(async () => {
      try { await result.current.editOwnPost('own-post', '真正想要保存的新内容') } catch { failed = true }
    })
    expect(failed).toBe(true)
    expect(result.current.posts.find(x => x.id === 'own-post')?.text).toBe('原来的真实分享')
    api.failWrite(0)
    await act(async () => { expect(await result.current.editOwnPost('own-post', '真正想要保存的新内容')).toBe(true) })
    expect(api.writes.some(x => x.includes('/posts/records/own-row'))).toBe(true)
    expect(result.current.posts.find(x => x.id === 'own-post')?.text).toBe('真正想要保存的新内容')
  })

  it('发帖写入失败时不提前出现在本地列表', async () => {
    const api = serveStore()
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.posts).toEqual([])
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try {
        await result.current.publish('这是一段真实分享内容', [], '慢生活')
      } catch {
        failed = true
      }
    })

    expect(failed).toBe(true)
    expect(result.current.posts).toEqual([])
    expect(api.writes.some(x => x.includes('/collections/posts/records'))).toBe(true)
  })

  it('活动创建写入失败时不提前出现活动或报名状态', async () => {
    const api = serveStore()
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.events).toEqual([])
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try {
        await result.current.createEvent({
          title: '真实线下茶会',
          city: '深圳',
          cover: '/cover.jpg',
          date: '2026-10-10',
          time: '14:00',
          capacity: 12,
          desc: '用于验证确认式写入的活动',
          tags: ['茶艺'],
        })
      } catch {
        failed = true
      }
    })

    expect(failed).toBe(true)
    expect(result.current.events).toEqual([])
    expect(result.current.reminders).toEqual([])
    expect(api.writes.some(x => x.includes('/collections/events/records'))).toBe(true)
  })

  it('帖子点赞写入失败时不提前改变本地点赞状态', async () => {
    const api = serveStore({
      posts: [{ id: 'post-row', sid: 'post-real', author_sid: 'member-a', text: '真实帖子', images: [], topic: '慢生活', at: 1 }],
      contentLikes: [],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    await act(async () => { await result.current.loadCommunityPosts({ page: 1, perPage: 18 }) })
    expect(result.current.posts[0]?.likes).toEqual([])
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try {
        await result.current.togglePostLike('post-real')
      } catch {
        failed = true
      }
    })

    expect(failed).toBe(true)
    expect(result.current.posts[0]?.likes).toEqual([])
  })

  it('取消提醒写入失败时仍保留原提醒状态', async () => {
    const api = serveStore({
      events: [{ id: 'event-row', sid: 'event-real', title: '真实活动', city: '深圳', cover: '', date: '2026-10-10', time: '14:00', capacity: 12, desc: '', tags: [], host: '测试', creator_sid: 'member-a' }],
      reminders: [{ id: 'reminder-row', sid: 'member-a:event-real', owner_sid: 'member-a', event_sid: 'event-real' }],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.reminders).toEqual(['event-real'])
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try {
        await result.current.toggleReminder('event-real')
      } catch {
        failed = true
      }
    })

    expect(failed).toBe(true)
    expect(result.current.reminders).toEqual(['event-real'])
  })

  it('跳过写入失败时不提前进入本地跳过列表', async () => {
    const api = serveStore({ profiles: [
      { id: 'p1', sid: 'member-a', nickname: '甲', gender: 'female', seeking: 'male', birth_date: '1990-01-01', city: '深圳', interests: ['阅读'], role: '' },
      { id: 'p2', sid: 'member-b', nickname: '乙', gender: 'male', seeking: 'female', birth_date: '1990-01-01', city: '深圳', interests: ['阅读'], role: '' },
    ] })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try { await result.current.pass('member-b') } catch { failed = true }
    })

    expect(failed).toBe(true)
    expect(result.current.passesOf('member-a')).not.toContain('member-b')
  })

  it('拉黑写入失败时不提前改变本地黑名单', async () => {
    const api = serveStore()
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try { await result.current.toggleBlock('member-b') } catch { failed = true }
    })

    expect(failed).toBe(true)
    expect(result.current.isBlocked('member-b')).toBe(false)
  })

  it('已读状态刷新后按 otherId 正确恢复，不再使用双人组合 key', async () => {
    serveStore({
      profiles: [
        { id: 'p1', sid: 'member-a', nickname: '甲', role: '' },
        { id: 'p2', sid: 'member-b', nickname: '乙', role: '' },
      ],
      reads: [{ id: 'read-row', sid: 'member-a:member-b', owner_sid: 'member-a', other_sid: 'member-b', at: 200 }],
      chats: [{ id: 'msg-row', sid: 'msg-1', sid_a: 'member-a', sid_b: 'member-b', from_sid: 'member-b', text: '你好', at: 100 }],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()

    expect(result.current.unread('member-b')).toBe(0)
  })

  it('历史重复足迹只保留同一访客的最近一次', async () => {
    serveStore({
      profiles: [
        { id: 'p1', sid: 'member-a', nickname: '甲', role: '' },
        { id: 'p2', sid: 'member-b', nickname: '乙', role: '' },
      ],
      visits: [
        { id: 'visit-old', sid: 'member-b:member-a:100', viewer_sid: 'member-b', viewed_sid: 'member-a', at: 100 },
        { id: 'visit-new', sid: 'member-b:member-a:200', viewer_sid: 'member-b', viewed_sid: 'member-a', at: 200 },
      ],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.visitorsOf('member-a')).toEqual([])
    await act(async () => { await result.current.loadMeHistory() })
    expect(result.current.visitorsOf('member-a')).toHaveLength(1)
    expect(result.current.visitorsOf('member-a')[0]).toMatchObject({ at: 200, user: { id: 'member-b' } })
  })

  it('周报活动按需统计未打开会话，不依赖 chatWith 本地历史', async () => {
    serveStore({
      profiles: [
        { id: 'p1', sid: 'member-a', nickname: '甲', role: '' },
        { id: 'p2', sid: 'member-b', nickname: '乙', role: '' },
      ],
      visits: [
        { id: 'v1', viewer_sid: 'member-b', viewed_sid: 'member-a', at: 200 },
        { id: 'v2', viewer_sid: 'member-a', viewed_sid: 'member-b', at: 250 },
      ],
      chats: [
        { id: 'm1', sid: 'm1', sid_a: 'member-a', sid_b: 'member-b', from_sid: 'member-b', text: '不会下发到周报', at: 210 },
        { id: 'm2', sid: 'm2', sid_a: 'member-a', sid_b: 'member-b', from_sid: 'member-a', text: '也不会下发到周报', at: 220 },
      ],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()

    expect(result.current.chatWith('member-b')).toEqual([])
    let weekly: Awaited<ReturnType<typeof result.current.loadWeeklyActivity>> | undefined
    await act(async () => { weekly = await result.current.loadWeeklyActivity(150) })
    expect(weekly?.visits).toHaveLength(2)
    expect(weekly?.messages).toEqual([
      { otherId: 'member-b', at: 210, direction: 'received' },
      { otherId: 'member-b', at: 220, direction: 'sent' },
    ])
    expect(result.current.users.some(u => u.id === 'member-b')).toBe(true)
  })

  it('设头像写入失败时不提前重排本地照片', async () => {
    const api = serveStore({ profiles: [{ id: 'p1', sid: 'member-a', nickname: '甲', photos: ['/a.jpg', '/b.jpg'], role: '' }] })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.me?.photos).toEqual(['/a.jpg', '/b.jpg'])
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try { await result.current.setAvatar(1) } catch { failed = true }
    })

    expect(failed).toBe(true)
    expect(result.current.me?.photos).toEqual(['/a.jpg', '/b.jpg'])
  })

  it('新增照片一次保存并把第一张新图直接设为头像', async () => {
    const api = serveStore({ profiles: [{ id: 'p1', sid: 'member-a', nickname: '甲', photos: ['/old.jpg'], role: '' }] })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()

    await act(async () => {
      await result.current.addPhotos(['/new-1.jpg', '/new-2.jpg'])
    })

    expect(result.current.me?.photos).toEqual(['/new-1.jpg', '/old.jpg', '/new-2.jpg'])
    expect(api.writes.filter(x => x === 'PATCH /api/collections/profiles/records/p1')).toHaveLength(1)
  })

  it('消息撤回写入失败时不提前标记为已撤回', async () => {
    const api = serveStore({
      profiles: [
        { id: 'p1', sid: 'member-a', nickname: '甲', role: '' },
        { id: 'p2', sid: 'member-b', nickname: '乙', role: '' },
      ],
      chats: [{ id: 'msg-row', sid: 'msg-1', sid_a: 'member-a', sid_b: 'member-b', from_sid: 'member-a', text: '刚刚发送', at: Date.now() }],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    await act(async () => { await result.current.loadChat('member-b') })
    expect(result.current.chatWith('member-b')[0]?.recalled).not.toBe(true)
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try { await result.current.recallMsg('member-b', 'msg-1') } catch { failed = true }
    })

    expect(failed).toBe(true)
    expect(result.current.chatWith('member-b')[0]?.recalled).not.toBe(true)
  })

  it('收藏分组新增失败时不提前写入本地分组', async () => {
    const api = serveStore()
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.favGroups).toEqual([])
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try { await result.current.addFavGroup('同城') } catch { failed = true }
    })

    expect(failed).toBe(true)
    expect(result.current.favGroups).toEqual([])
  })

  it('收藏归组失败时不提前改变本地归组', async () => {
    const api = serveStore({
      profiles: [
        { id: 'p1', sid: 'member-a', nickname: '甲', role: '' },
        { id: 'p2', sid: 'member-b', nickname: '乙', role: '' },
      ],
      favorites: [{ id: 'fav-row', sid: 'member-a:users:member-b', owner_sid: 'member-a', fav_type: 'users', target_sid: 'member-b', group_name: '' }],
      favGroups: [{ id: 'group-row', sid: 'member-a:同城', owner_sid: 'member-a', name: '同城' }],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.favGroupOf('member-b')).toBe('')
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try { await result.current.setFavGroup('member-b', '同城') } catch { failed = true }
    })

    expect(failed).toBe(true)
    expect(result.current.favGroupOf('member-b')).toBe('')
  })

  it('管理员设置写入失败时不提前改变本地设置', async () => {
    const api = serveStore({ profiles: [{ id: 'p1', sid: 'member-a', nickname: '掌柜', role: 'admin' }] })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    const before = result.current.settings.announcement
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try { await result.current.saveSettings({ announcement: '不会提前出现' }) } catch { failed = true }
    })

    expect(failed).toBe(true)
    expect(result.current.settings.announcement).toBe(before)
  })

  it('精选发布写入失败时不提前出现在本地合集', async () => {
    const api = serveStore({ profiles: [{ id: 'p1', sid: 'member-a', nickname: '掌柜', role: 'admin' }] })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.digests).toEqual([])
    api.failWrite(500)

    let failed = false
    await act(async () => {
      try {
        await result.current.publishDigest({ title: '本期精选', intro: '真实发布失败测试', postIds: ['post-real'] })
      } catch {
        failed = true
      }
    })

    expect(failed).toBe(true)
    expect(result.current.digests).toEqual([])
  })

  it('阅读计数写入失败时不制造本地假阅读数，成功后才增加', async () => {
    const api = serveStore({
      digests: [{ id: 'digest-row', sid: 'digest-1', issue: 1, title: '第一期', intro: '', post_sids: [], covers: [], at: 1, views: 3 }],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    await act(async () => { await result.current.loadCommunityDigests() })
    expect(result.current.digests[0]?.views).toBe(3)

    api.failWrite(500)
    await act(async () => { await result.current.viewDigest('digest-1') })
    expect(result.current.digests[0]?.views).toBe(3)

    api.failWrite(0)
    await act(async () => { await result.current.viewDigest('digest-1') })
    expect(result.current.digests[0]?.views).toBe(4)
  })
})

describe('真人推荐与 mutual 真实性', () => {
  const profiles = [
    { id: 'p1', sid: 'member-a', nickname: '甲', gender: 'female', seeking: 'male', birth_date: '1990-01-01', city: '深圳', interests: ['阅读', '徒步', '摄影'], role: '' },
    { id: 'p2', sid: 'member-b', nickname: '乙', gender: 'male', seeking: 'female', birth_date: '1990-01-01', city: '深圳', interests: ['阅读', '徒步', '摄影'], role: '' },
  ]

  it('资料未由本人确认或未成年时不进入推荐资格', () => {
    expect(isProfileReadyForMatching(readyProfile())).toBe(true)
    expect(isProfileReadyForMatching(readyProfile({ gender: 'unknown' }))).toBe(false)
    expect(isProfileReadyForMatching(readyProfile({ seeking: 'unknown' }))).toBe(false)
    expect(isProfileReadyForMatching(readyProfile({ birthDate: '' }))).toBe(false)
    expect(isProfileReadyForMatching(readyProfile({ birthDate: '2015-01-01' }))).toBe(false)
    expect(isProfileReadyForMatching(readyProfile({ city: '' }))).toBe(false)
  })

  it('单边有意不会被系统模拟成 mutual', async () => {
    serveStore({ profiles })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    await act(async () => { await result.current.loadDiscoveryProfiles({ page: 1, perPage: 24 }) })
    expect(result.current.candidates().map(u => u.id)).toContain('member-b')
    let matched = true
    await act(async () => { matched = await result.current.like('member-b') })
    expect(matched).toBe(false)
    expect(result.current.isMutual('member-b')).toBe(false)
  })

  it('有意写入失败时不提前更新本地状态', async () => {
    const api = serveStore({ profiles })
    api.failWrite(500)
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    let failed = false
    await act(async () => {
      try {
        await result.current.like('member-b')
      } catch {
        failed = true
      }
    })
    expect(failed).toBe(true)
    expect(result.current.likesOf('member-a')).not.toContain('member-b')
    expect(result.current.isMutual('member-b')).toBe(false)
  })

  it('已有真实反向有意时，本次本人有意才形成 mutual', async () => {
    serveStore({
      profiles,
      likes: [{ id: 'l1', sid: 'l1', owner_sid: 'member-b', target_sid: 'member-a' }],
    })
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    let matched = false
    await act(async () => { matched = await result.current.like('member-b') })
    expect(matched).toBe(true)
    expect(result.current.isMutual('member-b')).toBe(true)
  })
})
