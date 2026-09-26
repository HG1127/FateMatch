// @vitest-environment jsdom
import { act, cleanup, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from 'sonner'
import type { ReactNode } from 'react'
import { pb } from './pb'
import { StoreProvider, useStore } from './store'

function signIn(id: string) {
  const token = `test.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.test`
  pb.authStore.save(token, { id, collectionId: 'users', collectionName: 'users', email: `${id}@example.test`, name: id })
}

function wrapper({ children }: { children: ReactNode }) {
  return <><StoreProvider>{children}</StoreProvider><Toaster /></>
}

function serveStore() {
  const writes: string[] = []
  let failStatus = 0
  let pending: Promise<Response> | null = null
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (method !== 'GET') {
      writes.push(`${method} ${url.pathname}`)
      return Response.json({ id: 'written', ...(typeof init?.body === 'string' ? JSON.parse(init.body) : {}) })
    }
    const collection = url.pathname.split('/')[4]
    if (collection === 'profiles' && pending) return pending
    if (collection === 'profiles' && failStatus) return Response.json({ message: 'Read failed', data: {} }, { status: failStatus })
    const items = collection === 'profiles' ? [{ id: 'p1', sid: 'member-a', nickname: '远端会员', role: '' }] : []
    return Response.json({ page: 1, perPage: 200, totalPages: items.length ? 1 : 0, totalItems: items.length, items })
  })
  return {
    writes,
    fail: (status: number) => { failStatus = status },
    defer: (response: Promise<Response>) => { pending = response },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  pb.authStore.clear()
})

afterEach(() => {
  cleanup()
  pb.authStore.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

describe('初始化完成前禁止自动保存', () => {
  it.each([403, 500])('读取失败 %s 后结束加载，但不将临时数据写回', async status => {
    const api = serveStore()
    api.fail(status)
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.booted).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.writes).toEqual([])
    expect(screen.queryByText(/数据库连接失败/)).toBeNull()
    if (status === 403) expect(screen.getByText(/权限/)).toBeTruthy()
  })

  it('成功加载后仍允许保存，不是永久关闭自动保存', async () => {
    const api = serveStore()
    signIn('member-a')
    const { result } = renderHook(useStore, { wrapper })
    await settle()
    expect(result.current.me?.nickname).toBe('远端会员')
    expect(api.writes).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.writes).toContain('PATCH /__pb/api/collections/profiles/records/p1')
  })

  it('切换账号后，旧状态不能在新账号尚未加载时写回', async () => {
    const api = serveStore()
    signIn('member-a')
    renderHook(useStore, { wrapper })
    await settle()
    api.defer(new Promise(() => {}))
    act(() => signIn('member-b'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.writes).toEqual([])
  })

  it('退出后，过期的空库加载不能触发种子写入', async () => {
    const api = serveStore()
    let finish!: (response: Response) => void
    api.defer(new Promise(resolve => { finish = resolve }))
    signIn('member-a')
    renderHook(useStore, { wrapper })
    await settle()
    act(() => pb.authStore.clear())
    await settle()
    finish(Response.json({ page: 1, perPage: 200, totalPages: 0, totalItems: 0, items: [] }))
    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.writes).toEqual([])
  })
})
