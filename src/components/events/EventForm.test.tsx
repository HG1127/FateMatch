// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventForm } from '@/components/events/EventForm'

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(), updateEvent: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/store-context', () => ({
  useStore: () => ({
    me: { id: 'member-a', nickname: '甲', city: '杭州', region: '' },
    createEvent: mocks.createEvent,
    updateEvent: mocks.updateEvent,
    settings: { festTemplates: {} },
  }),
}))
vi.mock('sonner', () => ({ toast: mocks.toast }))

beforeEach(() => {
  mocks.createEvent.mockReset().mockResolvedValue('ev-1')
  mocks.updateEvent.mockReset()
  mocks.toast.mockClear()
  mocks.toast.success.mockClear()
  mocks.toast.error.mockClear()
})
afterEach(cleanup)

describe('活动发布信息透明化', () => {
  it('创建新线下活动要求明确集合区域和费用，且字段进入持久化命令', async () => {
    const onClose = vi.fn()
    const { container } = render(<EventForm open onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('如 桂香茶席 · 秋日场'), { target: { value: '周末读书茶会' } })
    const date = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10)
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: date } })
    fireEvent.change(container.querySelector('input[type="time"]')!, { target: { value: '14:00' } })
    fireEvent.click(screen.getByRole('button', { name: '发布活动' }))
    expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringContaining('集合区域'))
    expect(mocks.createEvent).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: '公开集合区域' }), { target: { value: '西湖区公园正门' } })
    fireEvent.click(screen.getByRole('button', { name: '发布活动' }))
    expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringContaining('收费'))
    fireEvent.change(screen.getByRole('textbox', { name: '活动费用说明' }), { target: { value: '免费' } })
    fireEvent.change(screen.getByRole('textbox', { name: '活动取消规则' }), { target: { value: '请提前一天取消' } })
    fireEvent.click(screen.getByRole('button', { name: '发布活动' }))
    await waitFor(() => expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      venue: '西湖区公园正门', costNote: '免费', cancelNote: '请提前一天取消',
    })))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
