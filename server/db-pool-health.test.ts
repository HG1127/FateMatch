import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { registerIdlePoolErrorHandler } from './db-pool-health.mjs'

describe('Neon 闲置连接掉线保护', () => {
  it('PostgreSQL idle pool 报错只记录脱敏错误码而不导致未处理事件退出', () => {
    const pool = new EventEmitter()
    const report = vi.fn()
    registerIdlePoolErrorHandler(pool, report)
    const error = Object.assign(new Error('secret database URL / SQL content'), { code: '57P01' })
    expect(() => pool.emit('error', error, { connectionParameters: { password: 'not-for-logs' } })).not.toThrow()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toContain('57P01')
    expect(report.mock.calls[0][0]).not.toContain('secret database')
    expect(report.mock.calls[0][0]).not.toContain('not-for-logs')
  })
})
