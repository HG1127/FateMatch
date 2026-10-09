import { describe, expect, it, vi } from 'vitest'
import { createSafetyHandlers } from './safety.mjs'

class HttpErr extends Error {
  status: number
  data?: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

const tq = (name: string) => `"test"."${name}"`
const needAuth = (auth: { id: string; role?: string } | null) => {
  if (!auth) throw new HttpErr(403, 'auth required')
  return auth
}
const needAdmin = (auth: { id: string; role?: string } | null) => {
  needAuth(auth)
  if (auth?.role !== 'admin') throw new HttpErr(403, 'admin required')
  return auth
}
const toRecord = (_table: string, row: Record<string, unknown>) => ({ ...row })

function makeDeps(clientQuery: ReturnType<typeof vi.fn>, q = vi.fn()) {
  const release = vi.fn()
  const pool = { connect: vi.fn().mockResolvedValue({ query: clientQuery, release }) }
  const secEvent = vi.fn()
  let words: string[] = ['已有词']
  const deps = {
    q,
    tq,
    needAuth,
    needAdmin,
    HttpErr,
    pool,
    toRecord,
    secEvent,
    defaultBlockedWords: ['底线词'],
    getExtraBlockedWords: () => words,
    setExtraBlockedWords: (next: string[]) => { words = next },
    now: () => 123456,
  }
  return { deps, pool, secEvent, release, words: () => words }
}

describe('safety domain', () => {
  it('举报 ban 在单事务内写处理结果并封禁目标', async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'r1', sid: 'rp1', target_sid: 'bad-user' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({})
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 'r1', sid: 'rp1', status: 'done', resolution: 'ban' }] })
    const { deps, secEvent, release } = makeDeps(clientQuery, q)
    const h = createSafetyHandlers(deps)

    await expect(h.handleAdminResolveReport('rp1', { action: 'ban' }, { id: 'admin', role: 'admin' }))
      .resolves.toMatchObject({ sid: 'rp1', status: 'done', resolution: 'ban' })

    expect(clientQuery.mock.calls.map(call => String(call[0]).trim().split(/\s+/)[0].toLowerCase()))
      .toEqual(['begin', 'select', 'update', 'update', 'commit'])
    expect(clientQuery.mock.calls[1][0]).toContain('for update')
    expect(clientQuery.mock.calls[3][1]).toEqual(['bad-user'])
    expect(secEvent).toHaveBeenCalledWith('report_resolved', expect.objectContaining({ actorSid: 'admin' }))
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('申诉使用行锁并在同一事务完成一次性检查与写入', async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'r1', sid: 'rp1', by_sid: 'me', status: 'done', appeal_status: '' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({})
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 'r1', sid: 'rp1', appeal_status: 'open', appeal_note: '请重新复核此事' }] })
    const { deps, secEvent } = makeDeps(clientQuery, q)
    const h = createSafetyHandlers(deps)

    await expect(h.handleReportAppeal('rp1', { note: '请重新复核此事' }, { id: 'me' }))
      .resolves.toMatchObject({ sid: 'rp1', appeal_status: 'open' })
    expect(clientQuery.mock.calls[1][0]).toContain('for update')
    expect(clientQuery.mock.calls[1][1]).toEqual(['rp1', 'me'])
    expect(clientQuery.mock.calls[2][1]).toEqual(['请重新复核此事', 123456, 'r1'])
    expect(secEvent).toHaveBeenCalledWith('report_appealed', expect.objectContaining({ actorSid: 'me' }))
  })

  it('已申诉工单拒绝第二次申诉并回滚', async () => {
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'r1', sid: 'rp1', by_sid: 'me', status: 'done', appeal_status: 'open' }] })
      .mockResolvedValueOnce({})
    const { deps, release } = makeDeps(clientQuery)
    const h = createSafetyHandlers(deps)

    await expect(h.handleReportAppeal('rp1', { note: '再次请求复核' }, { id: 'me' }))
      .rejects.toMatchObject({ status: 400 })
    expect(clientQuery.mock.calls[2][0]).toBe('rollback')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('会员只能按需读取自己的举报工单', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ sid: 'rp1', by_sid: 'me', target_sid: 'u2', status: 'open', at: 2 }] })
    const { deps } = makeDeps(vi.fn(), q)
    const h = createSafetyHandlers(deps)
    await expect(h.handleMyReports({ id: 'me' })).resolves.toEqual({
      items: [{ sid: 'rp1', by_sid: 'me', target_sid: 'u2', status: 'open', at: 2 }],
    })
    expect(q.mock.calls[0][1]).toEqual(['me'])
    await expect(h.handleMyReports(null)).rejects.toMatchObject({ status: 403 })
  })

  it('安全事件仅管理员可读并限制 limit/type', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 's1', type: 'login_success' }] })
    const { deps } = makeDeps(vi.fn(), q)
    const h = createSafetyHandlers(deps)

    await expect(h.handleAdminSecurityEvents(
      new URL('http://local/api/admin/security-events?limit=999&type=login_success'),
      { id: 'admin', role: 'admin' },
    )).resolves.toEqual({ items: [{ id: 's1', type: 'login_success' }] })
    expect(q.mock.calls[0][1]).toEqual([200, 'login_success'])
    await expect(h.handleAdminSecurityEvents(new URL('http://local/'), { id: 'me' }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('敏感词保存去重截断并同步内存缓存与审计', async () => {
    const q = vi.fn().mockResolvedValue({})
    const { deps, secEvent, words } = makeDeps(vi.fn(), q)
    const h = createSafetyHandlers(deps)
    const auth = { id: 'admin', role: 'admin' }

    await expect(h.handleAdminWordFilter({ method: 'GET' }, null, auth))
      .resolves.toEqual({ defaults: ['底线词'], words: ['已有词'] })

    const saved = await h.handleAdminWordFilter(
      { method: 'PUT' },
      { words: ['  新词  ', '新词', '另一个词'] },
      auth,
    )
    expect(saved.words).toEqual(['新词', '另一个词'])
    expect(words()).toEqual(['新词', '另一个词'])
    expect(JSON.parse(q.mock.calls[0][1][0])).toEqual(['新词', '另一个词'])
    expect(secEvent).toHaveBeenCalledWith('word_filter_updated', expect.objectContaining({ actorSid: 'admin' }))
  })
})
