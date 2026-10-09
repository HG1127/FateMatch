// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MoreDropdown } from './Layout'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function setup() {
  render(<MemoryRouter initialEntries={['/me']}><MoreDropdown /></MemoryRouter>)
  const trigger = screen.getByRole('button', { name: '更多' })
  const wrapper = trigger.parentElement as HTMLElement
  return { trigger, wrapper }
}

describe('顶部更多菜单交互', () => {
  it('鼠标悬停打开，经过按钮与菜单之间的间隙时不会立即消失', () => {
    const { trigger, wrapper } = setup()
    fireEvent.mouseEnter(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const navigation = screen.getByRole('navigation', { name: '更多导航' })
    expect(navigation).toBeInTheDocument()
    expect(navigation.parentElement).toHaveClass('pt-1')

    fireEvent.mouseLeave(wrapper)
    act(() => vi.advanceTimersByTime(80))
    expect(navigation).toBeInTheDocument()

    fireEvent.mouseEnter(navigation)
    act(() => vi.advanceTimersByTime(300))
    expect(navigation).toBeInTheDocument()

    fireEvent.mouseLeave(wrapper)
    act(() => vi.advanceTimersByTime(200))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('navigation', { name: '更多导航' })).toBeNull()
  })

  it('鼠标点击已悬停打开的按钮，不会意外把菜单关闭', () => {
    const { trigger } = setup()
    fireEvent.mouseEnter(trigger)
    fireEvent.click(trigger, { detail: 1 })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /同城/ })).toBeInTheDocument()
  })

  it('Esc 关闭并把键盘焦点还给按钮，点击外部也能关闭', () => {
    const { trigger } = setup()
    trigger.focus()
    fireEvent.click(trigger, { detail: 0 })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger, { detail: 0 })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('点击一个真实导航项即收起菜单', () => {
    const { trigger } = setup()
    fireEvent.mouseEnter(trigger)
    fireEvent.click(screen.getByRole('link', { name: /兴趣筛选/ }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('navigation', { name: '更多导航' })).toBeNull()
  })
})
