// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from '@/components/matches/ChatPanel'

const mocks = vi.hoisted(() => ({
  loadChat: vi.fn(),
  markRead: vi.fn(),
  pollChats: vi.fn(),
  sendChat: vi.fn(),
  recallMsg: vi.fn(),
  loadRelationshipFeedback: vi.fn(),
  setRelationshipFeedback: vi.fn(),
  chatWith: vi.fn((): Array<{ id: string; from: string; text: string; at: number }> => []),
}))

const me = {
  id: 'member-a',
  phone: '',
  password: '',
  nickname: '甲',
  gender: 'female' as const,
  seeking: 'male' as const,
  birthDate: '1990-01-01',
  city: '深圳',
  height: 165,
  job: '',
  bio: '',
  interests: ['阅读'],
  photos: ['/me.jpg'],
  verification: { phone: false, realname: false, photo: false },
  createdAt: 1,
}

const other = {
  ...me,
  id: 'member-b',
  nickname: '乙',
  gender: 'male' as const,
  seeking: 'female' as const,
  photos: ['/other.jpg'],
}

vi.mock('@/lib/store-context', () => ({
  useStore: () => ({
    me,
    chatWith: mocks.chatWith,
    loadChat: mocks.loadChat,
    sendChat: mocks.sendChat,
    icebreakerFor: () => '你好',
    markRead: mocks.markRead,
    recallMsg: mocks.recallMsg,
    pollChats: mocks.pollChats,
    loadRelationshipFeedback: mocks.loadRelationshipFeedback,
    setRelationshipFeedback: mocks.setRelationshipFeedback,
  }),
}))

beforeEach(() => {
  sessionStorage.clear()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true })
  mocks.loadChat.mockReset()
  mocks.markRead.mockReset()
  mocks.pollChats.mockReset()
  mocks.sendChat.mockReset()
  mocks.recallMsg.mockReset()
  mocks.loadRelationshipFeedback.mockReset()
  mocks.setRelationshipFeedback.mockReset()
  mocks.chatWith.mockReset()
  mocks.chatWith.mockReturnValue([])
  mocks.pollChats.mockResolvedValue(undefined)
  mocks.markRead.mockResolvedValue(undefined)
  mocks.loadRelationshipFeedback.mockResolvedValue({ available: true, eligible: false, outcome: null })
  mocks.setRelationshipFeedback.mockResolvedValue({ available: true, eligible: true, outcome: null })
})

afterEach(cleanup)

describe('ChatPanel 按需消息可靠性', () => {
  it('消息加载失败时不清未读，重试成功后才标记已读', async () => {
    mocks.loadChat.mockRejectedValueOnce(new Error('聊天记录暂时不可用')).mockResolvedValueOnce(undefined)

    render(<ChatPanel user={other} />)

    expect(await screen.findByText('聊天记录暂时不可用')).toBeInTheDocument()
    expect(mocks.markRead).not.toHaveBeenCalled()
    expect(screen.getByText('加载成功前不会清除未读状态。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))

    await waitFor(() => expect(mocks.loadChat).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1))
    expect(mocks.markRead).toHaveBeenCalledWith('member-b')
  })

  it('首次成功加载后再进入空会话欢迎态', async () => {
    mocks.loadChat.mockResolvedValue(undefined)

    render(<ChatPanel user={other} />)

    await waitFor(() => expect(mocks.loadChat).toHaveBeenCalledWith('member-b'))
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith('member-b'))
    expect(await screen.findByText('佳音已结,从一句「幸会」开始吧。')).toBeInTheDocument()
  })

  it('真实会话后展示本人关系反馈，改选不会影响聊天', async () => {
    mocks.loadChat.mockResolvedValue(undefined)
    mocks.chatWith.mockReturnValue([{ id: 'm1', from: 'member-a', text: '你好', at: Date.now() }])
    mocks.loadRelationshipFeedback.mockResolvedValue({ available: true, eligible: true, outcome: 'continue' })
    mocks.setRelationshipFeedback.mockResolvedValue({ available: true, eligible: true, outcome: 'pause' })

    render(<ChatPanel user={other} />)

    expect(await screen.findByRole('button', { name: '愿意继续认识' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '先暂停认识' }))
    await waitFor(() => expect(mocks.setRelationshipFeedback).toHaveBeenCalledWith('member-b', 'pause'))
    expect(screen.getByText('只作为你自己的试点反馈，不通知对方，也不会自动改变互配、聊天或推荐。')).toBeInTheDocument()
  })

  it('消息草稿只属于当前账户和会话，发送成功才清理', async () => {
    mocks.loadChat.mockResolvedValue(undefined)
    mocks.sendChat.mockResolvedValue(undefined)
    const view = render(<ChatPanel user={other} />)
    fireEvent.change(screen.getByPlaceholderText('写一句问候…'), { target: { value: '这是发给乙的未完成问候' } })
    view.unmount()
    const someoneElse = { ...other, id: 'member-c', nickname: '丙' }
    const otherView = render(<ChatPanel user={someoneElse} />)
    expect(screen.getByPlaceholderText('写一句问候…')).toHaveValue('')
    otherView.unmount()
    render(<ChatPanel user={other} />)
    expect(screen.getByPlaceholderText('写一句问候…')).toHaveValue('这是发给乙的未完成问候')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(mocks.sendChat).toHaveBeenCalledWith('member-b', '这是发给乙的未完成问候', undefined))
    await waitFor(() => expect(screen.getByPlaceholderText('写一句问候…')).toHaveValue(''))
    expect(sessionStorage.getItem('sy:ux-draft:v1:chat:member-a:member-b')).toBeNull()
  })

  it('首次发送真实消息后立即显示反馈入口，无需退出会话或刷新页面', async () => {
    mocks.loadChat.mockResolvedValue(undefined)
    mocks.sendChat.mockResolvedValue(undefined)
    const messages: Array<{ id: string; from: string; text: string; at: number }> = []
    mocks.chatWith.mockImplementation(() => messages)
    const view = render(<ChatPanel user={other} />)

    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith('member-b'))
    expect(screen.queryByRole('button', { name: '愿意继续认识' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('写一句问候…'), { target: { value: '初次问候' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(mocks.sendChat).toHaveBeenCalledWith('member-b', '初次问候', undefined))

    messages.push({ id: 'msg-1', from: 'member-a', text: '初次问候', at: Date.now() })
    mocks.loadRelationshipFeedback.mockResolvedValue({ available: true, eligible: true, outcome: null })
    view.rerender(<ChatPanel user={other} />)

    expect(await screen.findByRole('button', { name: '愿意继续认识' })).toBeInTheDocument()
    expect(mocks.loadRelationshipFeedback).toHaveBeenCalledWith('member-b')
  })
})
