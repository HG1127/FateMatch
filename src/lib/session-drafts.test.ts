// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { clearSessionDraft, readSessionDraft, saveSessionDraft } from './session-drafts'

beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T00:00:00Z')) })
afterEach(() => { sessionStorage.clear(); vi.useRealTimers() })

describe('本地文本草稿的账户与隐私隔离', () => {
  it('跨会话、跨账户不共享文本草稿', () => {
    saveSessionDraft('chat', 'alice', 'bob', { text: '只给 Bob 的话' })
    expect(readSessionDraft('chat', 'alice', 'bob')?.text).toBe('只给 Bob 的话')
    expect(readSessionDraft('chat', 'alice', 'charlie')).toBeNull()
    expect(readSessionDraft('chat', 'another-account', 'bob')).toBeNull()
    expect(readSessionDraft('post', 'alice', 'bob')).toBeNull()
  })
  it('自动删除空草稿，成功发送后可显式清理', () => {
    saveSessionDraft('chat', 'alice', 'bob', { text: 'hi' })
    saveSessionDraft('chat', 'alice', 'bob', { text: '' })
    expect(readSessionDraft('chat', 'alice', 'bob')).toBeNull()
    saveSessionDraft('post', 'alice', '', { text: '真实分享', topic: '认识我' })
    expect(readSessionDraft('post', 'alice')).toEqual({ text: '真实分享', topic: '认识我' })
    clearSessionDraft('post', 'alice')
    expect(readSessionDraft('post', 'alice')).toBeNull()
  })
  it('超期草稿不回显，损坏缓存不影响页面', () => {
    saveSessionDraft('chat', 'alice', 'bob', { text: '旧消息' })
    vi.advanceTimersByTime(8 * 86400_000)
    expect(readSessionDraft('chat', 'alice', 'bob')).toBeNull()
    sessionStorage.setItem('sy:ux-draft:v1:chat:alice:bob', '{')
    expect(readSessionDraft('chat', 'alice', 'bob')).toBeNull()
  })
})
