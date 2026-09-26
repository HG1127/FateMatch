import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadWorld } from './repo'

function serveCollections(profileResponse: (page: number) => Response) {
  const requests: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    requests.push(url.pathname + url.search)
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

    await expect(loadWorld(null)).rejects.toThrow(/数据库接口返回异常/)
    expect(requests.filter(url => url.includes('/profiles/'))).toHaveLength(1)
  })

  it.each([undefined, -1, 1.5, null])('拒绝无效的总页数 %s', async totalPages => {
    serveCollections(page => page === 1
      ? Response.json({ page, perPage: 200, totalItems: 0, totalPages, items: [] })
      : Response.json({ message: 'Unexpected extra page' }, { status: 503 }))

    await expect(loadWorld(null)).rejects.toThrow(/数据库接口返回异常/)
  })

  it('拒绝返回错误页码的接口', async () => {
    serveCollections(() => Response.json({ page: 0, perPage: 200, totalItems: 0, totalPages: 0, items: [] }))
    await expect(loadWorld(null)).rejects.toThrow(/数据库接口返回异常/)
  })

  it('正常读取空数据库', async () => {
    const requests = serveCollections(page => Response.json({ page, perPage: 200, totalItems: 0, totalPages: 0, items: [] }))
    const world = await loadWorld(null)

    expect(world.empty).toBe(true)
    expect(world.users).toEqual([])
    expect(requests.every(url => url.includes('page=1&'))).toBe(true)
  })

  it('合并全部有效分页并在最后一页停止', async () => {
    const requests = serveCollections(page => Response.json({
      page, perPage: 200, totalItems: 2, totalPages: 2,
      items: [{ id: `record-${page}`, sid: `member-${page}`, nickname: `会员${page}` }],
    }))
    const world = await loadWorld(null)

    expect(world.users.map(user => ({ id: user.id, nickname: user.nickname }))).toEqual([
      { id: 'member-1', nickname: '会员1' },
      { id: 'member-2', nickname: '会员2' },
    ])
    expect(requests.filter(url => url.includes('/profiles/'))).toHaveLength(2)
  })
})

function serveRoleCollections(role: 'guest' | 'member' | 'admin', failure?: { collection: string; status: number }) {
  const requests: string[] = []
  const publicCollections = ['profiles', 'posts', 'post_comments', 'events', 'event_comments', 'digests', 'site_settings', 'content_likes', 'event_attendees']
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const collection = url.pathname.split('/')[4]
    requests.push(collection)
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

describe('按身份加载数据', () => {
  it('未登录时只读公开表，不因私有表的权限影响公开资料', async () => {
    const requests = serveRoleCollections('guest')
    const world = await loadWorld(null)
    expect(world.users[0].nickname).toBe('当前会员')
    expect(world.match.chats).toEqual({})
    expect(world.adminLogs).toEqual([])
    expect(requests.sort()).toEqual(['content_likes', 'digests', 'event_attendees', 'event_comments', 'events', 'post_comments', 'posts', 'profiles', 'site_settings'])
  })

  it('普通会员加载私有数据，但不因其他人是管理员而读取管理日志', async () => {
    const requests = serveRoleCollections('member')
    const world = await loadWorld('member')
    expect(world.users[0].nickname).toBe('当前会员')
    expect(world.adminLogs).toEqual([])
    expect(requests).toContain('chat_messages')
    expect(requests).not.toContain('admin_logs')
  })

  it('没有会员档案的账号不读取管理日志', async () => {
    const requests = serveRoleCollections('member')
    await expect(loadWorld('new-member')).resolves.toMatchObject({ adminLogs: [] })
    expect(requests).not.toContain('admin_logs')
  })

  it('管理员读取管理日志，切换为普通会员后不复用管理数据', async () => {
    serveRoleCollections('admin')
    await expect(loadWorld('member')).resolves.toMatchObject({ adminLogs: [{ id: 'log1', text: '管理操作', at: 1 }] })
    const requests = serveRoleCollections('member')
    await expect(loadWorld('member')).resolves.toMatchObject({ adminLogs: [] })
    expect(requests).not.toContain('admin_logs')
  })

  it.each([403, 500])('应当可读的数据返回 %s 时仍然报错，不能当作空数据', async status => {
    serveRoleCollections('member', { collection: 'chat_messages', status })
    await expect(loadWorld('member')).rejects.toMatchObject({ status })
  })

  it('管理员日志真正读取失败时仍然报错', async () => {
    serveRoleCollections('admin', { collection: 'admin_logs', status: 403 })
    await expect(loadWorld('member')).rejects.toMatchObject({ status: 403 })
  })
})
