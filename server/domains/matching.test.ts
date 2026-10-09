import { describe, expect, it, vi } from 'vitest'
import { createMatchingGuards } from './matching.mjs'

class HttpErr extends Error {
  status: number
  data?: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

const tq = (name: string) => '"test"."' + name + '"'

describe('matching domain', () => {
  it('任一方向拉黑都拒绝心动；掌柜处置可跳过 block 检查', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ one: 1 }] })
    const g = createMatchingGuards({ q, tq, HttpErr })
    const data = new Map<string, unknown>([['owner_sid', 'a'], ['target_sid', 'b']])

    await expect(g.assertLikeAllowed(data, { id: 'a' })).rejects.toMatchObject({ status: 403 })
    await expect(g.assertLikeAllowed(data, { id: 'admin', role: 'admin' })).resolves.toBeUndefined()
    expect(q).toHaveBeenCalledTimes(1)
    expect(q.mock.calls[0][1]).toEqual(['a', 'b'])
  })

  it('私信要求本人发送且双方都存在真实有意', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { owner_sid: 'a', target_sid: 'b' },
        { owner_sid: 'b', target_sid: 'a' },
      ] })
    const g = createMatchingGuards({ q, tq, HttpErr })
    const data = new Map<string, unknown>([['sid_a', 'a'], ['sid_b', 'b'], ['from_sid', 'a']])

    await expect(g.assertMutualChat(data, { id: 'a' })).resolves.toBeUndefined()
    expect(q.mock.calls[1][0]).toContain('"test"."user_likes"')
    expect(q.mock.calls[1][1]).toEqual(['a', 'b'])
  })

  it('拒绝冒充发送、单向有意和无效会话成员', async () => {
    const g1 = createMatchingGuards({ q: vi.fn(), tq, HttpErr })
    await expect(g1.assertMutualChat(
      new Map<string, unknown>([['sid_a', 'a'], ['sid_b', 'b'], ['from_sid', 'b']]),
      { id: 'a' },
    )).rejects.toMatchObject({ status: 403 })

    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ owner_sid: 'a', target_sid: 'b' }] })
    const g2 = createMatchingGuards({ q, tq, HttpErr })
    await expect(g2.assertMutualChat(
      new Map<string, unknown>([['sid_a', 'a'], ['sid_b', 'b'], ['from_sid', 'a']]),
      { id: 'a' },
    )).rejects.toMatchObject({ status: 403 })

    await expect(g2.assertMutualChat(
      new Map<string, unknown>([['sid_a', 'a'], ['sid_b', 'a'], ['from_sid', 'a']]),
      { id: 'a' },
    )).rejects.toMatchObject({ status: 400 })
  })
})
