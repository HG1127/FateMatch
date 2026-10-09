// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Modal } from './ui'

afterEach(cleanup)

it('通用弹窗按 Esc 仅关闭最上层，关闭后恢复原焦点和页面滚动', () => {
  const outerClose = vi.fn()
  const innerClose = vi.fn()
  const { rerender } = render(
    <div>
      <button>打开资料</button>
      <Modal open onClose={outerClose}><p>资料内容</p></Modal>
      <Modal open onClose={innerClose}><p>举报确认</p></Modal>
    </div>,
  )
  expect(document.body.style.overflow).toBe('hidden')
  expect(screen.getAllByRole('dialog')).toHaveLength(2)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(innerClose).toHaveBeenCalledTimes(1)
  expect(outerClose).not.toHaveBeenCalled()
  rerender(
    <div><button>打开资料</button><Modal open onClose={outerClose}><p>资料内容</p></Modal><Modal open={false} onClose={innerClose}><p>举报确认</p></Modal></div>,
  )
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(outerClose).toHaveBeenCalledTimes(1)
  rerender(<button>打开资料</button>)
  expect(document.body.style.overflow).toBe('')
})
