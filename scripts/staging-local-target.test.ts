import { describe, expect, it } from 'vitest'
import { assertIsolatedLocalDev } from './staging-local-target.mjs'

const safe = {
  STAGING_MODE: '1',
  NEON_SCHEMA: 'staging_local_dev',
  NEON_DSN: 'postgresql://suiyuan_staging_owner:fake-password@ep-test.ap-southeast-1.aws.neon.tech/suiyuan_staging?sslmode=require',
}

describe('独立版本地数据库隔离闸门', () => {
  it('允许使用独立 Staging 数据库且不触发任何连接', () => {
    expect(() => assertIsolatedLocalDev(safe)).not.toThrow()
  })
  it('禁止复用生产 public 或未开启 Staging 模式', () => {
    expect(() => assertIsolatedLocalDev({ ...safe, STAGING_MODE: '0' })).toThrow(/STAGING_MODE/)
    expect(() => assertIsolatedLocalDev({ ...safe, NEON_SCHEMA: 'public' })).toThrow(/NEON_SCHEMA/)
    expect(() => assertIsolatedLocalDev({ ...safe, NEON_SCHEMA: 'staging_public' })).toThrow(/NEON_SCHEMA/)
  })
  it('禁止生产数据库及其他账号，即使 schema 看似 Staging', () => {
    expect(() => assertIsolatedLocalDev({ ...safe, NEON_DSN: 'postgresql://prod_user:fake@ep-test.ap-southeast-1.aws.neon.tech/neondb' })).toThrow(/禁止生产数据库/)
    expect(() => assertIsolatedLocalDev({ ...safe, NEON_DSN: 'postgresql://suiyuan_staging_owner:fake@ep-test.ap-southeast-1.aws.neon.tech/neondb' })).toThrow(/禁止生产数据库/)
    expect(() => assertIsolatedLocalDev({ ...safe, NEON_DSN: 'postgresql://suiyuan_staging_owner:fake@localhost/suiyuan_staging' })).toThrow(/禁止生产数据库/)
    expect(() => assertIsolatedLocalDev({ ...safe, NEON_DSN: 'invalid' })).toThrow(/合法/)
  })
})
