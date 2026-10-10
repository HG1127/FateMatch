// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Lightbox } from './ui'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

function Preview() {
  const [src, setSrc] = useState('/favicon.svg')
  return (
    <>
      <button type="button">查看图片</button>
      <Lightbox src={src} onClose={() => setSrc('')} />
    </>
  )
}

describe('移动端图片预览操作', () => {
  it('弹出时锁定背景滚动，显示可触控的明确关闭按钮，关闭后恢复焦点', () => {
    render(<Preview />)
    expect(screen.getByRole('dialog', { name: '图片放大预览' })).toBeInTheDocument()
    const close = screen.getByRole('button', { name: '关闭图片预览' })
    expect(close).toHaveFocus()
    expect(close).toHaveClass('h-11', 'w-11')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(close)
    expect(screen.queryByRole('dialog', { name: '图片放大预览' })).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('键盘 Esc 关闭，不需要点击遮罩', () => {
    const onClose = vi.fn()
    render(<Lightbox src="/favicon.svg" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('没有图片时不锁定页面滚动', () => {
    render(<Lightbox src="" onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
