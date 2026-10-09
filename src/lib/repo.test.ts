import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchChatActivity, fetchChatConversation, fetchChatSummaries, fetchCommunityDigests, fetchCommunityPosts, fetchDiscoveryProfiles, fetchEventDetail, fetchEventsPage, fetchMyReports, fetchMyVisits, fetchProfilesByIds, loadWorld, persistProfile } from './repo'

function serveCollections(profileResponse: (page: number) => Response) {
  const requests: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    requests.push(url.pathname + url.search)
    if (url.pathname.endsWith('/api/profiles/lookup')) {
      return Response.json({ items: [{ id: 'lookup-self', sid: 'member', nickname: '管理员', role: 'admin' }] })
    }
    const page = Number(url.searchParams.get('page'))
    if (url.pathname.includes('/profiles/')) return profileResponse(page)
    return Response.json({ page, perPage: 200, totalItems: 0, totalPages: 0, items: [] })
  })
  return requests
}

afterEach(() => vi.unstubAllGlobals())

describe('数据库初始化分页', () => {
  it('HTML 响应立即报错，不继续翻页', async () => {
    const requests = serveCollections(page => page === 1
      ? new Response('<!doctype html><html><body>Vite</body></html>', { headers: { 'Content-Type': 'text/html' } })
      : Response.json({ message: 'Unexpected extra page' }, { status: 503 }))

    await expect(loadWorld('member')).rejects.toThrow(/数据库接口返回异常/)
    expect(requests.filter(url => url.includes('/api/collections/profiles/records'))).toHaveLength(1)
  })

  it.each([undefined, -1, 1.5, null])('拒绝无效的总页数 %s', async totalPages => {
    serveCollections(page => page === 1
      ? Response.json({ page, perPage: 200, totalItems: 0, totalPages, items: [] })
      : Response.json({ message: 'Unexpected extra page' }, { status: 503 }))

    await expect(loadWorld('member')).rejects.toThrow(/数据库接口返回异常/)
  })

  it('拒绝返回错误页码的接口', async () => {
    serveCollections(() => Response.json({ page: 0, perPage: 200, totalItems: 0, totalPages: 0, items: [] }))
    await expect(loadWorld('member')).rejects.toThrow(/数据库接口返回异常/)
  })

  it('正常读取空数据库', async () => {
    const requests = serveCollections(page => Response.json({ page, perPage: 200, totalItems: 0, totalPages: 0, items: [] }))
    const world = await loadWorld('member')

    expect(world.empty).toBe(true)
    expect(world.users).toEqual([])
    expect(requests.filter(url => url.includes('/api/collections/')).every(url => url.includes('page=1&'))).toBe(true)
  })

  it('合并全部有效分页并在最后一页停止', async () => {
    const requests = serveCollections(page => Response.json({
      page, perPage: 200, totalItems: 2, totalPages: 2,
      items: [{ id: `record-${page}`, sid: `member-${page}`, nickname: `会员${page}` }],
    }))
    const world = await loadWorld('member')

    expect(world.users.map(user => ({ id: user.id, nickname: user.nickname }))).toEqual([
      { id: 'member-1', nickname: '会员1' },
      { id: 'member-2', nickname: '会员2' },
    ])
    expect(world.users[0]).toMatchObject({
      gender: 'unknown',
      seeking: 'unknown',
      birthDate: '',
      height: 0,
    })
    expect(requests.filter(url => url.includes('/api/collections/profiles/records'))).toHaveLength(2)
  })
})

describe('人物按需补齐', () => {
  it('只按明确人物 ID 请求资料，不依赖启动全量 profiles', async () => {
    let requested = ''
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      requested = url.pathname + url.search
      return Response.json({ items: [{ id: 'p2', sid: 'member-b', nickname: '乙', gender: 'female', seeking: 'male', birth_date: '1995-01-01', city: '杭州', interests: [] }] })
    })

    await expect(fetchProfilesByIds(['member-b'])).resolves.toMatchObject([{ id: 'member-b', nickname: '乙', city: '杭州' }])
    expect(requested).toContain('/api/profiles/lookup?')
    expect(decodeURIComponent(requested)).toContain('ids=member-b')
  })

  it('超过单次上限时自动分批补齐人物，不静默丢关系对象', async () => {
    const requestedChunks: string[][] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
      requestedChunks.push(ids)
      return Response.json({ items: ids.map((sid, i) => ({ id: `row-${requestedChunks.length}-${i}`, sid, nickname: sid })) })
    })

    const ids = Array.from({ length: 81 }, (_, i) => `member-${i + 1}`)
    const users = await fetchProfilesByIds(ids)
    expect(users).toHaveLength(81)
    expect(requestedChunks.map(chunk => chunk.length)).toEqual([80, 1])
  })
})

describe('人物发现分页', () => {
  it('把筛选与分页参数下沉到专用接口，并映射为 User', async () => {
    let requested = ''
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      requested = url.pathname + url.search
      if (!url.pathname.endsWith('/api/discovery/profiles')) return Response.json({ message: 'unexpected' }, { status: 404 })
      return Response.json({
        page: 2,
        perPage: 24,
        totalItems: 30,
        totalPages: 2,
        items: [{
          id: 'row-p2', sid: 'member-b', nickname: '乙', gender: 'female', seeking: 'male',
          birth_date: '1995-01-01', city: '杭州', region: '浙江省·杭州市·西湖区', height: 165,
          job: '设计师', bio: '真实资料', interests: ['摄影', '看展'], photos: ['/photo.jpg'],
          verification: { phone: true, realname: true, photo: false }, created_at: 123,
        }],
      })
    })

    const page = await fetchDiscoveryProfiles({
      page: 2,
      perPage: 24,
      city: '杭州',
      district: '西湖区',
      tags: ['摄影', '看展'],
      verifiedOnly: true,
    })

    expect(requested).toContain('/api/discovery/profiles?')
    expect(requested).toContain('page=2')
    expect(requested).toContain('perPage=24')
    expect(decodeURIComponent(requested)).toContain('city=杭州')
    expect(decodeURIComponent(requested)).toContain('district=西湖区')
    expect(decodeURIComponent(requested)).toContain('tags=摄影,看展')
    expect(requested).toContain('verified=1')
    expect(page).toMatchObject({ page: 2, perPage: 24, totalItems: 30, totalPages: 2 })
    expect(page.items[0]).toMatchObject({
      id: 'member-b', nickname: '乙', gender: 'female', seeking: 'male', city: '杭州',
      region: '浙江省·杭州市·西湖区', job: '设计师', interests: ['摄影', '看展'],
      verification: { phone: true, realname: true, photo: false }, createdAt: 123,
    })
  })

  it('专用接口返回异常结构时明确报错', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ page: 1, items: null }))
    await expect(fetchDiscoveryProfiles({ page: 1 })).rejects.toThrow(/人物列表返回异常/)
  })
})

describe('社区按需分页', () => {
  it('把筛选、排序、分页和指定帖子 ID 下沉到社区接口', async () => {
    let requested = ''
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      requested = url.pathname + url.search
      if (!url.pathname.endsWith('/api/community/posts')) return Response.json({ message: 'unexpected' }, { status: 404 })
      return Response.json({
        page: 2,
        perPage: 18,
        totalItems: 23,
        totalPages: 2,
        items: [{
          id: 'post-real', authorId: 'member-b', text: '长安夜游', images: ['/post.jpg'], topic: '汉服',
          featured: true, likes: ['member-a', 'anon:1'], comments: [{ id: 'c1', authorId: 'member-c', text: '想参加', at: 12, likes: [] }], at: 10,
        }],
      })
    })

    const page = await fetchCommunityPosts({
      page: 2,
      perPage: 18,
      topic: '汉服',
      q: '长安',
      sort: 'hot',
      localFirst: false,
      ids: ['post-real', 'post-2'],
    })

    expect(requested).toContain('/api/community/posts?')
    expect(requested).toContain('page=2')
    expect(requested).toContain('perPage=18')
    expect(decodeURIComponent(requested)).toContain('topic=汉服')
    expect(decodeURIComponent(requested)).toContain('q=长安')
    expect(requested).toContain('sort=hot')
    expect(requested).toContain('localFirst=0')
    expect(decodeURIComponent(requested)).toContain('ids=post-real,post-2')
    expect(page).toMatchObject({ page: 2, perPage: 18, totalItems: 23, totalPages: 2 })
    expect(page.items[0]).toMatchObject({
      id: 'post-real', authorId: 'member-b', topic: '汉服', featured: true, likes: ['member-a', 'anon:1'],
      comments: [{ id: 'c1', authorId: 'member-c', text: '想参加', at: 12, likes: [], pinned: false }],
    })
  })

  it('精选合集按专用接口映射，不依赖当前帖子列表', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      if (!url.pathname.endsWith('/api/community/digests')) return Response.json({ message: 'unexpected' }, { status: 404 })
      return Response.json([{ id: 'row-d1', sid: 'dg-real', issue: 7, title: '第七期', intro: '本期导语', post_sids: ['p1', 'p2'], cover: '/c.jpg', covers: ['/c.jpg'], at: 99, views: 8 }])
    })

    await expect(fetchCommunityDigests()).resolves.toEqual([{
      id: 'dg-real', issue: 7, title: '第七期', intro: '本期导语', postIds: ['p1', 'p2'], at: 99, cover: '/c.jpg', covers: ['/c.jpg'], views: 8,
    }])
  })
})

describe('活动按需列表与详情', () => {
  it('把活动范围、日期和分页参数下沉到列表接口', async () => {
    let requested = ''
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      requested = url.pathname + url.search
      if (!url.pathname.endsWith('/api/events/list')) return Response.json({ message: 'unexpected' }, { status: 404 })
      return Response.json({
        page: 2,
        perPage: 18,
        totalItems: 22,
        totalPages: 2,
        items: [{ id: 'event-real', title: '真实活动', city: '深圳', cover: '/e.jpg', date: '2026-10-10', time: '14:00', capacity: 12, desc: '详情', tags: ['茶艺'], attendees: ['member-a', 'anon:event:1'], host: '主办', creatorId: 'member-b', pinned: true, images: [], comments: [] }],
      })
    })

    const page = await fetchEventsPage({ page: 2, perPage: 18, scope: 'calendar', from: '2026-10-01', to: '2026-10-31', localFirst: false })

    expect(requested).toContain('/api/events/list?')
    expect(requested).toContain('page=2')
    expect(requested).toContain('perPage=18')
    expect(requested).toContain('scope=calendar')
    expect(requested).toContain('from=2026-10-01')
    expect(requested).toContain('to=2026-10-31')
    expect(requested).toContain('localFirst=0')
    expect(page).toMatchObject({ page: 2, perPage: 18, totalItems: 22, totalPages: 2 })
    expect(page.items[0]).toMatchObject({ id: 'event-real', title: '真实活动', attendees: ['member-a', 'anon:event:1'], pinned: true })
  })

  it('活动详情映射完整事件和权限范围内联系方式', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      if (!url.pathname.endsWith('/api/events/event-real/detail')) return Response.json({ message: 'unexpected' }, { status: 404 })
      return Response.json({
        event: { id: 'event-real', title: '真实活动', city: '深圳', cover: '/e.jpg', date: '2026-10-10', time: '14:00', capacity: 12, desc: '详情', tags: ['茶艺'], attendees: ['member-a', 'member-b'], host: '主办', creatorId: 'member-a', comments: [{ id: 'ec1', authorId: 'member-b', text: '期待', at: 3, likes: ['member-a'], pinned: true }] },
        contacts: { 'member-b': 'wx:test' },
      })
    })

    await expect(fetchEventDetail('event-real')).resolves.toMatchObject({
      event: { id: 'event-real', attendees: ['member-a', 'member-b'], comments: [{ id: 'ec1', authorId: 'member-b', text: '期待', pinned: true }] },
      contacts: { 'member-b': 'wx:test' },
    })
  })
})

describe('私信按需读取', () => {
  it('登录首包只读取会话摘要字段', async () => {
    let requested = ''
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      requested = url.pathname
      return Response.json({
        items: [{ otherId: 'member-b', lastAt: 20, lastText: '最近一句', lastFrom: 'member-b', unread: 2 }],
      })
    })

    await expect(fetchChatSummaries()).resolves.toEqual([
      { otherId: 'member-b', lastAt: 20, lastText: '最近一句', lastFrom: 'member-b', unread: 2 },
    ])
    expect(requested).toContain('/api/chats/summaries')
  })

  it('打开会话后才读取该对象的完整消息', async () => {
    let requested = ''
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      requested = url.pathname
      return Response.json({
        items: [{ id: 'msg-1', recordId: 'row-1', from: 'member-b', text: '你好', at: 10, recalled: false, images: ['/a.jpg'] }],
      })
    })

    await expect(fetchChatConversation('member-b')).resolves.toEqual([
      { id: 'msg-1', from: 'member-b', text: '你好', at: 10, recalled: false, images: ['/a.jpg'] },
    ])
    expect(requested).toContain('/api/chats/member-b/messages')
  })
})

describe('本人私有历史按需读取', () => {
  it('访客轨迹、消息活动和举报工单走独立自助端点', async () => {
    const requested: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
      requested.push(url.pathname + url.search)
      if (url.pathname.endsWith('/api/me/visits')) {
        return Response.json({ items: [{ viewerId: 'other', viewedId: 'member', at: 20 }] })
      }
      if (url.pathname.endsWith('/api/me/chat-activity')) {
        return Response.json({ items: [{ otherId: 'other', at: 30, direction: 'received' }] })
      }
      if (url.pathname.endsWith('/api/me/reports')) {
        return Response.json({ items: [{ sid: 'rp1', by_sid: 'member', target_sid: 'other', reason: '骚扰', note: '说明', status: 'open', at: 40 }] })
      }
      return Response.json({ message: 'unexpected' }, { status: 404 })
    })

    await expect(fetchMyVisits(10, 50)).resolves.toEqual([{ viewerId: 'other', viewedId: 'member', at: 20 }])
    await expect(fetchChatActivity(10)).resolves.toEqual([{ otherId: 'other', at: 30, direction: 'received' }])
    await expect(fetchMyReports()).resolves.toEqual([expect.objectContaining({ id: 'rp1', by: 'member', target: 'other', reason: '骚扰', at: 40 })])
    expect(requested[0]).toContain('/api/me/visits?')
    expect(requested[0]).toContain('since=10')
    expect(requested[0]).toContain('limit=50')
    expect(requested[1]).toContain('/api/me/chat-activity?since=10')
    expect(requested[2]).toContain('/api/me/reports')
  })
})

function serveRoleCollections(role: 'guest' | 'member' | 'admin', failure?: { collection: string; status: number }) {
  const requests: string[] = []
  const publicCollections = ['site_settings']
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const collection = url.pathname.split('/')[4]
    if (url.pathname.endsWith('/api/chats/summaries')) {
      requests.push('chat_summaries')
      if (failure?.collection === 'chat_summaries') return Response.json({ message: 'Read failed', data: {} }, { status: failure.status })
      if (role === 'guest') return Response.json({ message: 'You are not allowed to perform this operation.', data: {} }, { status: 403 })
      return Response.json({ items: [] })
    }
    requests.push(collection)
    if (url.pathname.endsWith('/api/profiles/lookup')) {
      requests[requests.length - 1] = 'profile_lookup'
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
      const rows = [
        { id: 'p1', sid: 'member', nickname: '当前会员', role: role === 'admin' ? 'admin' : '' },
        { id: 'p2', sid: 'other-admin', nickname: '其他管理员', role: 'admin' },
      ].filter(row => ids.includes(row.sid))
      return Response.json({ items: rows })
    }
    if (failure?.collection === collection) return Response.json({ message: 'Read failed', data: {} }, { status: failure.status })
    if ((role === 'guest' && !publicCollections.includes(collection)) || (collection === 'admin_logs' && role !== 'admin')) {
      return Response.json({ message: 'You are not allowed to perform this operation.', data: {} }, { status: 403 })
    }
    const items = collection === 'profiles'
      ? [{ id: 'p1', sid: 'member', nickname: '当前会员', role: role === 'admin' ? 'admin' : '' }, { id: 'p2', sid: 'other-admin', role: 'admin' }]
      : collection === 'admin_logs' ? [{ id: 'l1', sid: 'log1', text: '管理操作', at: 1 }] : []
    return Response.json({ page: 1, perPage: 200, totalPages: items.length ? 1 : 0, totalItems: items.length, items })
  })
  return requests
}

function serveWriteFixture() {
  const writes: Array<{ method: string; collection: string; id: string | null; body: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (method === 'GET' && url.pathname.endsWith('/api/profiles/lookup')) {
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
      const rows = [
        {
          id: 'profile-me', sid: 'member', nickname: '当前会员', gender: 'male', seeking: 'female',
          birth_date: '1990-01-01', city: '杭州', region: '', height: 175, job: '产品经理', bio: '',
          interests: ['摄影', '旅行', '电影'], photos: [], verification: { phone: false, realname: false, photo: false },
          badge_dates: {}, stealth: false, banned: false, role: '', created_at: 1,
        },
        {
          id: 'profile-other', sid: 'other', nickname: '其他会员', gender: 'female', seeking: 'male',
          birth_date: '1992-02-02', city: '杭州', region: '', height: 165, job: '设计师', bio: '',
          interests: ['摄影', '看展', '音乐'], photos: [], verification: { phone: false, realname: false, photo: false },
          badge_dates: {}, stealth: false, banned: false, role: '', created_at: 2,
        },
      ].filter(row => ids.includes(row.sid))
      return Response.json({ items: rows })
    }
    const m = url.pathname.match(/\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?/)
    const collection = m?.[1] ?? ''
    const id = m?.[2] ?? null
    if (method !== 'GET') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
      writes.push({ method, collection, id, body })
      return Response.json({ id: id ?? 'written', sid: String(body.sid ?? ''), ...body })
    }

    let items: Array<Record<string, unknown>> = []
    if (collection === 'profiles') {
      items = [
        {
          id: 'profile-me', sid: 'member', nickname: '当前会员', gender: 'male', seeking: 'female',
          birth_date: '1990-01-01', city: '杭州', region: '', height: 175, job: '产品经理', bio: '',
          interests: ['摄影', '旅行', '电影'], photos: [], verification: { phone: false, realname: false, photo: false },
          badge_dates: {}, stealth: false, banned: false, role: '', created_at: 1,
        },
        {
          id: 'profile-other', sid: 'other', nickname: '其他会员', gender: 'female', seeking: 'male',
          birth_date: '1992-02-02', city: '杭州', region: '', height: 165, job: '设计师', bio: '',
          interests: ['摄影', '看展', '音乐'], photos: [], verification: { phone: false, realname: false, photo: false },
          badge_dates: {}, stealth: false, banned: false, role: '', created_at: 2,
        },
      ]
    } else if (collection === 'site_settings') {
      items = [{
        id: 'settings-main', sid: 'main',
        features: { yuanfen: true, explore: true, events: true, community: true, matches: true },
        stories: [], announcement: '', hidden_events: [], fest_templates: {},
      }]
    }
    return Response.json({ page: 1, perPage: 200, totalPages: items.length ? 1 : 0, totalItems: items.length, items })
  })
  return writes
}

describe('确认式写入边界', () => {
  it('本人资料使用独立确认式命令 PATCH', async () => {
    const writes = serveWriteFixture()
    const world = await loadWorld('member')
    const mine = { ...world.users.find(u => u.id === 'member')!, nickname: '新的昵称' }

    await persistProfile(mine)

    const profileWrites = writes.filter(w => w.collection === 'profiles')
    expect(profileWrites).toHaveLength(1)
    expect(profileWrites[0]).toMatchObject({ method: 'PATCH', id: 'profile-me' })
    expect(profileWrites[0].body.nickname).toBe('新的昵称')
    expect(profileWrites[0].body.role).toBeUndefined()
    expect(profileWrites[0].body.banned).toBeUndefined()
  })
})

describe('按身份加载数据', () => {
  it('未登录时不请求真人业务集合，只读取公开站点设置', async () => {
    const requests = serveRoleCollections('guest')
    const world = await loadWorld(null)
    expect(world.users).toEqual([])
    expect(world.posts).toEqual([])
    expect(world.events).toEqual([])
    expect(world.match.chats).toEqual({})
    expect(world.adminLogs).toEqual([])
    expect(requests).toEqual(['site_settings'])
  })

  it('普通会员加载私有数据，但不因其他人是管理员而读取管理日志', async () => {
    const requests = serveRoleCollections('member')
    const world = await loadWorld('member')
    expect(world.users[0].nickname).toBe('当前会员')
    expect(world.adminLogs).toEqual([])
    expect(requests).toContain('chat_summaries')
    expect(requests).not.toContain('chat_messages')
    expect(requests).toContain('profile_lookup')
    expect(requests).not.toContain('profiles')
    expect(requests).not.toContain('events')
    expect(requests).not.toContain('event_comments')
    expect(requests).not.toContain('event_attendees')
    expect(requests).not.toContain('visits')
    expect(requests).not.toContain('contacts')
    expect(requests).not.toContain('reports')
    expect(requests).not.toContain('admin_logs')
  })

  it('没有会员档案的账号不读取管理日志', async () => {
    const requests = serveRoleCollections('member')
    await expect(loadWorld('new-member')).resolves.toMatchObject({ adminLogs: [] })
    expect(requests).not.toContain('admin_logs')
  })

  it('管理员读取完整活动管理数据与管理日志，切换为普通会员后不复用', async () => {
    const adminRequests = serveRoleCollections('admin')
    await expect(loadWorld('member')).resolves.toMatchObject({ adminLogs: [{ id: 'log1', text: '管理操作', at: 1 }] })
    expect(adminRequests).toContain('events')
    expect(adminRequests).toContain('profile_lookup')
    expect(adminRequests).toContain('profiles')
    expect(adminRequests).toContain('event_comments')
    expect(adminRequests).toContain('event_attendees')
    expect(adminRequests).toContain('reports')
    expect(adminRequests).not.toContain('visits')
    expect(adminRequests).not.toContain('contacts')
    const requests = serveRoleCollections('member')
    await expect(loadWorld('member')).resolves.toMatchObject({ adminLogs: [] })
    expect(requests).not.toContain('admin_logs')
  })

  it.each([403, 500])('应当可读的数据返回 %s 时仍然报错，不能当作空数据', async status => {
    serveRoleCollections('member', { collection: 'chat_summaries', status })
    await expect(loadWorld('member')).rejects.toMatchObject({ status })
  })

  it('管理员日志真正读取失败时仍然报错', async () => {
    serveRoleCollections('admin', { collection: 'admin_logs', status: 403 })
    await expect(loadWorld('member')).rejects.toMatchObject({ status: 403 })
  })
})
