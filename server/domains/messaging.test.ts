import { describe, expect, it, vi } from 'vitest'
import { createMessagingHandlers } from './messaging.mjs'

class HttpErr extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const tq = (name: string) => `"test"."${name}"`
const needAuth = (auth: { id: string } | null) => {
  if (!auth) throw new HttpErr(403, 'auth required')
  return auth
}

describe('messaging domain', () => {
  it('会话摘要保持最后消息、撤回文案与未读数字段契约', async () => {
    const q = vi.fn().mockResolvedValue({
      rows: [
        { other_sid: 'b', last_at: 20, last_text: '旧正文', last_from: 'b', unread: 3, recalled: true },
        { other_sid: 'c', last_at: 10, last_text: '你好', last_from: 'me', unread: 0, recalled: false },
      ],
    })
    const { handleChatSummaries } = createMessagingHandlers({ q, tq, needAuth, HttpErr })

    await expect(handleChatSummaries({ id: 'me' })).resolves.toEqual({
      items: [
        { otherId: 'b', lastAt: 20, lastText: '消息已撤回', lastFrom: 'b', unread: 3 },
        { otherId: 'c', lastAt: 10, lastText: '你好', lastFrom: 'me', unread: 0 },
      ],
    })
    expect(q).toHaveBeenCalledTimes(1)
    expect(q.mock.calls[0][0]).toContain('"test"."chat_messages"')
    expect(q.mock.calls[0][0]).toContain('"test"."user_reads"')
    expect(q.mock.calls[0][1]).toEqual(['me'])
  })

  it('单会话映射保留逻辑 sid 与数据库 recordId，供撤回命令使用', async () => {
    const q = vi.fn().mockResolvedValue({
      rows: [{
        id: 'row-1',
        sid: 'msg-1',
        from_sid: 'b',
        text: '你好',
        at: 12,
        recalled: false,
        images: ['/a.jpg'],
      }],
    })
    const { handleChatConversation } = createMessagingHandlers({ q, tq, needAuth, HttpErr })

    await expect(handleChatConversation('b', { id: 'me' })).resolves.toEqual({
      items: [{
        id: 'msg-1',
        recordId: 'row-1',
        from: 'b',
        text: '你好',
        at: 12,
        recalled: false,
        images: ['/a.jpg'],
      }],
    })
    expect(q.mock.calls[0][1]).toEqual(['me', 'b'])
  })

  it('周报消息活动只返回对象、时间和方向，不下发正文', async () => {
    const q = vi.fn().mockResolvedValue({
      rows: [
        { other_sid: 'b', at: 10, direction: 'sent' },
        { other_sid: 'c', at: 20, direction: 'received' },
      ],
    })
    const { handleChatActivity } = createMessagingHandlers({ q, tq, needAuth, HttpErr })
    await expect(handleChatActivity(new URL('http://local/api/me/chat-activity?since=5'), { id: 'me' })).resolves.toEqual({
      items: [
        { otherId: 'b', at: 10, direction: 'sent' },
        { otherId: 'c', at: 20, direction: 'received' },
      ],
    })
    expect(q.mock.calls[0][0]).not.toContain('text')
    expect(q.mock.calls[0][1]).toEqual(['me', 5])
    await expect(handleChatActivity(new URL('http://local/api/me/chat-activity'), { id: 'me' })).rejects.toMatchObject({ status: 400 })
  })

  it('关系反馈只读取本人当前选择，并要求互配且已有真实消息', async () => {
    const q = vi.fn().mockResolvedValueOnce({ rows: [{ mutual: true, has_chat: true, outcome: 'continue' }] })
    const { handleRelationshipFeedback } = createMessagingHandlers({ q, tq, needAuth, HttpErr })
    await expect(handleRelationshipFeedback('b', { id: 'me' })).resolves.toEqual({ available: true, eligible: true, outcome: 'continue' })
    expect(q.mock.calls[0][0]).toContain('relationship_feedback')
    expect(q.mock.calls[0][1]).toEqual(['me', 'b'])
  })

  it('关系反馈可改选和撤回；没有真实消息时拒绝提交', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [{ mutual: true, has_chat: true, outcome: null }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [{ mutual: true, has_chat: false, outcome: null }] })
    const h = createMessagingHandlers({ q, tq, needAuth, HttpErr })

    await expect(h.handleRelationshipFeedbackSet('b', { outcome: 'pause' }, { id: 'me' }))
      .resolves.toEqual({ available: true, eligible: true, outcome: 'pause' })
    expect(q.mock.calls[1][0]).toContain('on conflict (owner_sid, other_sid)')
    expect(q.mock.calls[1][1].slice(1, 4)).toEqual(['me', 'b', 'pause'])

    await expect(h.handleRelationshipFeedbackSet('b', { outcome: null }, { id: 'me' }))
      .resolves.toEqual({ available: true, eligible: true, outcome: null })
    expect(q.mock.calls[2][0]).toContain('delete from')

    await expect(h.handleRelationshipFeedbackSet('c', { outcome: 'continue' }, { id: 'me' }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('拒绝空对象、自聊与匿名读取', async () => {
    const q = vi.fn()
    const { handleChatConversation, handleChatSummaries } = createMessagingHandlers({ q, tq, needAuth, HttpErr })

    await expect(handleChatSummaries(null)).rejects.toMatchObject({ status: 403 })
    await expect(handleChatConversation('', { id: 'me' })).rejects.toMatchObject({ status: 400 })
    await expect(handleChatConversation('me', { id: 'me' })).rejects.toMatchObject({ status: 400 })
    expect(q).not.toHaveBeenCalled()
  })
})
