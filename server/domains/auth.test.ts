import { describe, expect, it, vi } from 'vitest'
import { createAuthHandlers } from './auth.mjs'

class HttpErr extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const tq = (name: string) => '"test"."' + name + '"'
const needAuth = (auth: { id: string } | null) => {
  if (!auth) throw new HttpErr(403, 'auth required')
  return auth
}

function makeDeps(q: ReturnType<typeof vi.fn>, comparePassword = vi.fn(() => true)) {
  const assertNotLocked = vi.fn()
  const noteAuthFail = vi.fn()
  const clearAuthFail = vi.fn()
  const secEvent = vi.fn()
  const signToken = vi.fn((payload: Record<string, unknown>) => 'token:' + payload.id)
  const deps = {
    q,
    tq,
    needAuth,
    HttpErr,
    parseAuthBody: (body: { identity: string; password: string }) => body,
    assertNotLocked,
    noteAuthFail,
    clearAuthFail,
    comparePassword,
    secEvent,
    signToken,
    pwFingerprint: (hash: string) => 'fp:' + hash,
    colIdOf: () => 'users-col',
    toRecord: (_table: string, row: Record<string, unknown>) => ({ id: row.id, email: row.email }),
    nowSeconds: () => 1000,
  }
  return { deps, assertNotLocked, noteAuthFail, clearAuthFail, secEvent, signToken }
}

describe('auth domain', () => {
  it('成功登录先检查锁定与封禁，再清失败计数并签发带密码指纹 token', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'User@Example.com', password_hash: 'hash1' }] })
      .mockResolvedValueOnce({ rows: [{ banned: false }] })
    const { deps, assertNotLocked, clearAuthFail, secEvent, signToken } = makeDeps(q)
    const h = createAuthHandlers(deps)

    await expect(h.handleAuthWithPassword({ identity: 'USER@example.com', password: 'pw' }, '1.2.3.4')).resolves.toEqual({
      token: 'token:u1',
      record: { id: 'u1', email: 'User@Example.com' },
    })
    expect(assertNotLocked).toHaveBeenCalledWith('user@example.com', '1.2.3.4')
    expect(clearAuthFail).toHaveBeenCalledWith('user@example.com')
    expect(secEvent).toHaveBeenCalledWith('login_success', expect.objectContaining({ actorSid: 'u1', identity: 'user@example.com' }))
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', pv: 'fp:hash1', exp: 1000 + 14 * 86400 }))
  })

  it('密码错误记录失败且不查询封禁，不签发 token', async () => {
    const q = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'u@test', password_hash: 'hash1' }] })
    const { deps, noteAuthFail, signToken } = makeDeps(q, vi.fn(() => false))
    const h = createAuthHandlers(deps)

    await expect(h.handleAuthWithPassword({ identity: 'u@test', password: 'bad' }, 'ip')).rejects.toMatchObject({ status: 400 })
    expect(noteAuthFail).toHaveBeenCalledWith('u@test', 'ip')
    expect(q).toHaveBeenCalledTimes(1)
    expect(signToken).not.toHaveBeenCalled()
  })

  it('正确密码但账号已停用仍拒绝，且不会清除失败状态', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'u@test', password_hash: 'hash1' }] })
      .mockResolvedValueOnce({ rows: [{ banned: true }] })
    const { deps, clearAuthFail, signToken } = makeDeps(q)
    const h = createAuthHandlers(deps)

    await expect(h.handleAuthWithPassword({ identity: 'u@test', password: 'ok' }, 'ip')).rejects.toMatchObject({ status: 403 })
    expect(clearAuthFail).not.toHaveBeenCalled()
    expect(signToken).not.toHaveBeenCalled()
  })

  it('刷新只接受已认证账号，并使用当前密码哈希重新签发', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 'u1', email: 'u@test', password_hash: 'hash2' }] })
    const { deps, signToken } = makeDeps(q)
    const h = createAuthHandlers(deps)

    await expect(h.handleAuthRefresh({ id: 'u1' })).resolves.toEqual({
      token: 'token:u1',
      record: { id: 'u1', email: 'u@test' },
    })
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', pv: 'fp:hash2' }))
    await expect(h.handleAuthRefresh(null)).rejects.toMatchObject({ status: 403 })
  })
})
