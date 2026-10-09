import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { evaluateStagingConfig } from './staging-preflight.mjs'

const valid = {
  STAGING_NEON_DSN: 'postgresql://staging.test/staging_database',
  STAGING_SCHEMA: 'staging_rc20261009',
  STAGING_PORT: '8081',
}

describe('预发布凭据与 schema 错配保护', () => {
  it('独立 staging 前缀和本地端口符合基础配置闸门', () => {
    expect(evaluateStagingConfig(valid)).toMatchObject({ ready: true, blockers: [] })
  })
  it('禁止缺少凭据、public schema、复用生产连接以及非法端口', () => {
    for (const patch of [
      { STAGING_NEON_DSN: '' },
      { STAGING_SCHEMA: 'public' },
      { STAGING_SCHEMA: 'staging_public' },
      { STAGING_SCHEMA: 'e2e_smoke_1' },
      { NEON_DSN: valid.STAGING_NEON_DSN },
      { STAGING_PORT: '80' },
    ]) {
      expect(evaluateStagingConfig({ ...valid, ...patch }).ready).toBe(false)
    }
  })
  it('网关预发布模式直接拒绝 public schema（在任何数据库连接之前）', () => {
    const result = spawnSync(process.execPath, ['server/neon-gateway.mjs'], {
      encoding: 'utf8', timeout: 8000, windowsHide: true,
      env: { ...process.env, STAGING_MODE: '1', NEON_SCHEMA: 'public', NEON_DSN: 'postgresql://not-used.invalid/test' },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('预发布模式只允许 staging_* schema')
  })

  it('拒绝环境中缺少 schema（不能回退到生产 public）', () => {
    expect(evaluateStagingConfig({ STAGING_NEON_DSN: valid.STAGING_NEON_DSN }).blockers).toContain('staging-schema')
  })
})
