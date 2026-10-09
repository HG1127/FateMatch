import { describe, expect, it, vi } from 'vitest'
import { createProfileHandlers } from './profiles.mjs'

class HttpErr extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const tq = (name: string) => `"test"."${name}"`
const needAuth = (auth: { id: string; role?: string } | null) => {
  if (!auth) throw new HttpErr(403, 'auth required')
  return auth
}
const toRecord = (_table: string, row: Record<string, unknown>) => ({ ...row })

describe('profiles read domain', () => {
  it('lookup 对普通会员剥离他人的管理字段，但保留本人字段', async () => {
    const q = vi.fn().mockResolvedValue({
      rows: [
        { id: 'r1', sid: 'me', nickname: '我', role: '', banned: false },
        { id: 'r2', sid: 'other', nickname: '对方', role: 'admin', banned: true },
      ],
    })
    const { handleProfileLookup } = createProfileHandlers({ q, tq, needAuth, HttpErr, toRecord })
    const url = new URL('http://local/api/profiles/lookup?ids=me,other,other')

    const out = await handleProfileLookup(url, { id: 'me' })
    expect(q.mock.calls[0][1]).toEqual([['me', 'other']])
    expect(out.items[0]).toMatchObject({ sid: 'me', role: '', banned: false })
    expect(out.items[1]).toEqual(expect.objectContaining({ sid: 'other', nickname: '对方' }))
    expect(out.items[1]).not.toHaveProperty('role')
    expect(out.items[1]).not.toHaveProperty('banned')
  })

  it('本人访问轨迹只返回双方 ID 和时间，并限制最大条数', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [
      { viewer_sid: 'a', viewed_sid: 'me', at: 20 },
      { viewer_sid: 'me', viewed_sid: 'b', at: 10 },
    ] })
    const { handleMyVisits } = createProfileHandlers({ q, tq, needAuth, HttpErr, toRecord })
    await expect(handleMyVisits(new URL('http://local/api/me/visits?since=5&limit=9999'), { id: 'me' })).resolves.toEqual({
      items: [
        { viewerId: 'a', viewedId: 'me', at: 20 },
        { viewerId: 'me', viewedId: 'b', at: 10 },
      ],
    })
    expect(q.mock.calls[0][1]).toEqual(['me', 5, 1000])
    expect(q.mock.calls[0][0]).toContain('distinct on (viewer_sid, viewed_sid)')
  })

  it('discovery 对本人执行成年与必要资料门槛', async () => {
    const q = vi.fn().mockResolvedValueOnce({
      rows: [{ sid: 'me', gender: 'female', seeking: 'male', birth_date: '2010-01-01', city: '深圳' }],
    })
    const handlers = createProfileHandlers({
      q,
      tq,
      needAuth,
      HttpErr,
      toRecord,
      now: () => new Date('2026-09-28T00:00:00Z'),
    })

    await expect(
      handlers.handleDiscoveryProfiles(new URL('http://local/api/discovery/profiles'), { id: 'me' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(q).toHaveBeenCalledTimes(1)
  })

  it('discovery 保持服务端筛选、分页和 DTO 契约', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ sid: 'me', gender: 'female', seeking: 'male', birth_date: '1990-01-01', city: '深圳' }],
      })
      .mockResolvedValueOnce({ rows: [{ n: 25 }] })
      .mockResolvedValueOnce({ rows: [{ sid: 'b', nickname: '乙', gender: 'male', seeking: 'female' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })

    const handlers = createProfileHandlers({
      q,
      tq,
      needAuth,
      HttpErr,
      toRecord,
      now: () => new Date('2026-09-28T00:00:00Z'),
    })
    const url = new URL('http://local/api/discovery/profiles?page=2&perPage=10&city=深圳&district=南山&verified=1&tags=阅读,徒步')
    const out = await handlers.handleDiscoveryProfiles(url, { id: 'me' })

    expect(out).toMatchObject({ page: 2, perPage: 10, totalItems: 25, totalPages: 3 })
    expect(out.items).toEqual([{ sid: 'b', nickname: '乙', gender: 'male', seeking: 'female' }])
    expect(q.mock.calls[1][0]).toContain("p.birth_date <= '2008-09-28'")
    expect(q.mock.calls[1][0]).toContain('user_passes')
    expect(q.mock.calls[1][0]).toContain('blocks')
    expect(q.mock.calls[1][0]).toContain("verification->>'phone'")
    const listSql = q.mock.calls[2][0] as string
    expect(listSql).toContain('order by (p.city = $')
    expect(q.mock.calls[2][1].slice(-3)).toEqual(['深圳', 10, 10])
    expect(q.mock.calls[3][0]).toContain('discovery_exposures')
    expect(q.mock.calls[3][1][0]).toBe('me')
    expect(q.mock.calls[3][1][1]).toBe('2026-09-28')
    expect(q.mock.calls[3][1][3]).toEqual(['b'])
  })

  it('年龄偏好在服务端限制筛选与总量统计，且按日期边界计算', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [{ sid: 'me', gender: 'female', seeking: 'male', birth_date: '1990-01-01', city: '深圳' }] })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] })
      .mockResolvedValueOnce({ rows: [{ sid: 'u2', gender: 'male', seeking: 'female', birth_date: '1998-05-01' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
    const { handleDiscoveryProfiles } = createProfileHandlers({ q, tq, needAuth, HttpErr, toRecord, now: () => new Date('2026-09-28T00:00:00Z') })
    await handleDiscoveryProfiles(new URL('http://local/api/discovery/profiles?ageMin=25&ageMax=40'), { id: 'me' })
    const [countQuery, args] = q.mock.calls[1] as [string, unknown[]]
    expect(countQuery).toContain('p.birth_date <= $5')
    expect(countQuery).toContain('p.birth_date > $6')
    expect(args.slice(4, 6)).toEqual(['2001-09-28', '1985-09-28'])
    expect(q.mock.calls[2][1].slice(0, 6)).toEqual(args.slice(0, 6))
  })

  it('拒绝无效或反转的年龄范围，不执行人物枚举', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ sid: 'me', gender: 'female', seeking: 'male', birth_date: '1990-01-01', city: '深圳' }] })
    const { handleDiscoveryProfiles } = createProfileHandlers({ q, tq, needAuth, HttpErr, toRecord, now: () => new Date('2026-09-28T00:00:00Z') })
    for (const bad of ['ageMin=17', 'ageMax=999', 'ageMin=50&ageMax=25', 'ageMin=nan']) {
      await expect(handleDiscoveryProfiles(new URL(`http://local/api/discovery/profiles?${bad}`), { id: 'me' })).rejects.toMatchObject({ status: 400 })
    }
    expect(q).toHaveBeenCalledTimes(4)
  })

  it('试点遥测表尚未迁移时不阻断核心 discovery', async () => {
    const missingTable = Object.assign(new Error('missing relation'), { code: '42P01' })
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [{ sid: 'me', gender: 'female', seeking: 'male', birth_date: '1990-01-01', city: '深圳' }] })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] })
      .mockResolvedValueOnce({ rows: [{ sid: 'b', nickname: '乙', gender: 'male', seeking: 'female' }] })
      .mockRejectedValueOnce(missingTable)
    const handlers = createProfileHandlers({ q, tq, needAuth, HttpErr, toRecord, now: () => new Date('2026-09-28T00:00:00Z') })

    await expect(handlers.handleDiscoveryProfiles(new URL('http://local/api/discovery/profiles'), { id: 'me' }))
      .resolves.toMatchObject({ totalItems: 1, items: [{ sid: 'b' }] })
  })
})
