import { describe, expect, it, vi } from 'vitest'
import { createAdminHandlers } from './admin.mjs'

class HttpErr extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const tq = (name: string) => '"test"."' + name + '"'
const needAdmin = (auth: { id: string; role?: string } | null) => {
  if (!auth || auth.role !== 'admin') throw new HttpErr(403, 'admin required')
  return auth
}

describe('admin domain', () => {
  it('重置密码只返回本次临时密码并写哈希、计数与审计', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'u1@example.com' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
    const metrics = { startedAt: 1000, requests: 0, latencyTotalMs: 0, passwordResets: 0 }
    const secEvent = vi.fn()
    const h = createAdminHandlers({
      q, tq, needAdmin, HttpErr,
      hashPassword: (value: string) => 'hash:' + value,
      metrics, secEvent,
      tableCount: () => 24,
      randomInt: () => 0,
    })

    const out = await h.handleAdminResetPassword('u1', { id: 'admin', role: 'admin' })
    expect(out.tempPassword).toBe('aaaaaaaaaaaa')
    expect(q.mock.calls[1][1]).toEqual(['hash:aaaaaaaaaaaa', 'u1'])
    expect(metrics.passwordResets).toBe(1)
    expect(secEvent).toHaveBeenCalledWith('password_reset', expect.objectContaining({
      actorSid: 'admin',
      identity: 'u1@example.com',
    }))
  })

  it('普通成员不能重置密码或读取指标', async () => {
    const h = createAdminHandlers({
      q: vi.fn(), tq, needAdmin, HttpErr,
      hashPassword: (value: string) => value,
      metrics: { startedAt: 0, requests: 0, latencyTotalMs: 0, passwordResets: 0 },
      secEvent: vi.fn(),
      tableCount: () => 0,
    })
    await expect(h.handleAdminResetPassword('u1', { id: 'me' })).rejects.toMatchObject({ status: 403 })
    expect(() => h.handleMetrics({ id: 'me' })).toThrow(expect.objectContaining({ status: 403 }))
    await expect(h.handlePilotMetrics(new URL('http://local/api/admin/pilot-metrics'), { id: 'me' })).rejects.toMatchObject({ status: 403 })
  })

  it('指标只基于共享运行态计算派生值', () => {
    const metrics = { startedAt: 1000, requests: 4, latencyTotalMs: 42, passwordResets: 2 }
    const h = createAdminHandlers({
      q: vi.fn(), tq, needAdmin, HttpErr,
      hashPassword: (value: string) => value,
      metrics,
      secEvent: vi.fn(),
      tableCount: () => 23,
      now: () => 6100,
      heapUsedBytes: () => 10 * 1048576,
    })
    const out = h.handleMetrics({ id: 'admin', role: 'admin' })
    expect(out).toMatchObject({
      code: 200,
      data: { requests: 4, passwordResets: 2, uptimeSec: 5, avgLatencyMs: 11, tables: 23, heapUsedMB: 10 },
    })
  })

  it('试点指标只返回聚合供给、曝光公平与漏斗，不返回逐人明细', async () => {
    const q = vi.fn(async (sql: string) => {
      if (sql.includes('with eligible as')) return { rows: [{ eligible_profiles: 10, cities: [{ city: '深圳', n: 7 }, { city: '广州', n: 3 }] }] }
      if (sql.includes('with base as')) return { rows: [{ deliveries: 20, viewers: 4, targets: 8, target_dist: [6, 4, 3, 2, 2, 1, 1, 1].map((n, i) => ({ target_sid: `u${i}`, n })), sources: [{ source: 'explore', n: 20 }] }] }
      if (sql.includes('with chat_pairs as')) return { rows: [{ likes: 7, mutual_pairs: 2, conversations: 3, two_way_conversations: 2, messages: 9, event_joins: 4, event_checkins: 3, feedback_continue: 2, feedback_pause: 1 }] }
      throw new Error(`unexpected SQL: ${sql}`)
    })
    const h = createAdminHandlers({
      q, tq, needAdmin, HttpErr,
      hashPassword: (value: string) => value,
      metrics: { startedAt: 0, requests: 0, latencyTotalMs: 0, passwordResets: 0 },
      secEvent: vi.fn(), tableCount: () => 0,
      now: () => Date.parse('2026-09-28T00:00:00Z'),
    })

    const out = await h.handlePilotMetrics(new URL('http://local/api/admin/pilot-metrics?days=7'), { id: 'admin', role: 'admin' })
    expect(out).toMatchObject({
      available: true,
      days: 7,
      supply: { eligibleProfiles: 10, byCity: [{ city: '深圳', count: 7 }, { city: '广州', count: 3 }] },
      exposure: { deliveries: 20, viewers: 4, targets: 8, coverageRate: 80, top10Share: 30, maxPerTarget: 6 },
      funnel: { likes: 7, mutualPairs: 2, conversations: 3, twoWayConversations: 2, messages: 9, eventJoins: 4, eventCheckins: 3, feedbackContinue: 2, feedbackPause: 1 },
    })
    expect(JSON.stringify(out)).not.toContain('viewer_sid')
    expect(JSON.stringify(out)).not.toContain('target_sid')
  })

  it('试点遥测表未迁移时掌柜收到显式 unavailable，而不是 500', async () => {
    const q = vi.fn().mockRejectedValue(Object.assign(new Error('missing relation'), { code: '42P01' }))
    const h = createAdminHandlers({
      q, tq, needAdmin, HttpErr,
      hashPassword: (value: string) => value,
      metrics: { startedAt: 0, requests: 0, latencyTotalMs: 0, passwordResets: 0 },
      secEvent: vi.fn(), tableCount: () => 0,
    })
    await expect(h.handlePilotMetrics(new URL('http://local/api/admin/pilot-metrics'), { id: 'admin', role: 'admin' }))
      .resolves.toEqual({ available: false, days: 7, reason: 'migration_required' })
  })
})
