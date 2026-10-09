import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createEventHandlers } from './events.mjs'

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
const toRecord = (_table: string, row: Record<string, unknown>) => ({ ...row })
const fixedNow = new Date('2026-10-10T06:30:00.000Z').getTime()
const secret = 'test-checkin-secret'
const event = {
  id: 'row-e1', sid: 'event-1', title: '茶会', city: '深圳', date: '2026-10-10', time: '14:00',
  capacity: 20, creator_sid: 'host', tags: ['茶艺'], images: [], cover: '/e.jpg', desc: '详情', host: '主办', venue: '公园大门', cost_note: '免费', cancel_note: '提前一天取消',
}
function make(q: ReturnType<typeof vi.fn>) {
  return createEventHandlers({
    q, tq, needAuth, HttpErr, toRecord,
    genId: () => 'new-checkin',
    getCheckinSecret: () => secret,
    now: () => fixedNow,
  })
}
function codeFor(sid: string, date: string) {
  const hex = crypto.createHmac('sha256', secret).update(`checkin:${sid}:${date}`).digest('hex').slice(0, 12)
  return String(parseInt(hex, 16) % 1_000_000).padStart(6, '0')
}

describe('events domain', () => {
  it('列表匿名化报名者，仅保留本人报名状态', async () => {
    const q = vi.fn(async (sql: string) => {
      if (sql.includes('select city from')) return { rows: [{ city: '深圳' }] }
      if (sql.includes('select hidden_events')) return { rows: [{ hidden_events: [] }] }
      if (sql.includes('select count(*)::int n from')) return { rows: [{ n: 1 }] }
      if (sql.includes('select e.*, coalesce')) return { rows: [{ ...event, attendee_count: 2, joined_by_me: true }] }
      if (sql.includes('select distinct on (event_sid)')) return { rows: [] }
      throw new Error('unexpected sql: ' + sql)
    })
    const out = await make(q).handleEventList(new URL('http://local/api/events/list?scope=upcoming&perPage=18'), { id: 'me' })
    expect(out.totalItems).toBe(1)
    expect(out.items[0]).toMatchObject({ venue: '公园大门', costNote: '免费', cancelNote: '提前一天取消' })
    expect(out.items[0].attendees).toEqual(['me', 'anon:event:event-1:1'])
    const countSql = String(q.mock.calls.find(([sql]) => String(sql).includes('count(*)::int n'))?.[0] ?? '')
    expect(countSql).toContain('$1::text is not null')
  })

  it('普通成员详情只看到匿名 roster 且不读取联系方式', async () => {
    const q = vi.fn(async (sql: string) => {
      if (sql.includes('select * from') && sql.includes('"events"')) return { rows: [event] }
      if (sql.includes('select hidden_events')) return { rows: [{ hidden_events: [] }] }
      if (sql.includes('select owner_sid from')) return { rows: [{ owner_sid: 'me' }, { owner_sid: 'other' }] }
      if (sql.includes('select * from') && sql.includes('"event_comments"')) return { rows: [{ sid: 'c1', author_sid: 'other', text: '期待', at: 1, pinned: false }] }
      if (sql.includes('select target_sid')) return { rows: [{ target_sid: 'c1', cnt: 2, mine: true }] }
      if (sql.includes('select user_sid, text')) throw new Error('ordinary member must not read contacts')
      throw new Error('unexpected sql: ' + sql)
    })
    const out = await make(q).handleEventDetail('event-1', { id: 'me' })
    expect(out.event.attendees).toEqual(['me', 'anon:event:event-1:1'])
    expect(out.event.comments[0].likes).toEqual(['me', 'anon:event-comment:c1:1'])
    expect(out.contacts).toEqual({})
  })

  it('活动发起人能看到真实报名名单与联系方式', async () => {
    const q = vi.fn(async (sql: string) => {
      if (sql.includes('select * from') && sql.includes('"events"')) return { rows: [event] }
      if (sql.includes('select hidden_events')) return { rows: [{ hidden_events: [] }] }
      if (sql.includes('select owner_sid from')) return { rows: [{ owner_sid: 'u1' }, { owner_sid: 'u2' }] }
      if (sql.includes('select * from') && sql.includes('"event_comments"')) return { rows: [] }
      if (sql.includes('select user_sid, text')) return { rows: [{ user_sid: 'u1', text: 'wx:u1' }] }
      throw new Error('unexpected sql: ' + sql)
    })
    const out = await make(q).handleEventDetail('event-1', { id: 'host' })
    expect(out.event.attendees).toEqual(['u1', 'u2'])
    expect(out.contacts).toEqual({ u1: 'wx:u1' })
  })

  it('签到码仅主办方可在时间窗内读取', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [event] })
    const h = make(q)
    await expect(h.handleEventCheckinCode('event-1', { id: 'other' })).rejects.toMatchObject({ status: 403 })
    const out = await h.handleEventCheckinCode('event-1', { id: 'host' })
    expect(out.code).toMatch(/^\d{6}$/)
    expect(out.open).toBe(true)
  })

  it('已报名成员凭码签到，并由唯一 sid 保持并发幂等', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [event] })
      .mockResolvedValueOnce({ rows: [{ one: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-checkin', sid: 'me:event-1', owner_sid: 'me', event_sid: 'event-1' }] })
    const out = await make(q).handleEventCheckin('event-1', { code: codeFor('event-1', '2026-10-10') }, { id: 'me' })
    expect(out.checkedIn).toBe(true)
    expect(String(q.mock.calls[3][0])).toContain('on conflict (sid) do nothing')
  })

  it('本人活动统计不读取正文', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ joined_events: 3, own_posts: 4, last_comment_at: 123 }] })
    await expect(make(q).handleMyActivityStats({ id: 'me' })).resolves.toEqual({
      joinedEvents: 3, ownPosts: 4, lastCommentAt: 123,
    })
    expect(q.mock.calls[0][1]).toEqual(['me'])
  })
})
