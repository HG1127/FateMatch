import { describe, expect, it } from 'vitest'
import { createVercelSplitConfig, validateBackendOrigin } from './vercel-split-config.mjs'

const preview = {
  SUIYUAN_DEPLOY_MODE: 'staging',
  SUIYUAN_BACKEND_ORIGIN: 'https://suiyuan-staging-api.onrender.com',
  VERCEL_ENV: 'preview',
}

describe('Vercel front / separate Node staging gateway', () => {
  it('preserves both PocketBase compatibility and REST+uploads under same origin', () => {
    const c = createVercelSplitConfig(preview)
    expect(c.framework).toBe('vite')
    expect(c.buildCommand).toContain('vercel-build.mjs')
    expect(c.rewrites).toEqual([
      { source: '/__pb/:path*', destination: 'https://suiyuan-staging-api.onrender.com/__pb/:path*' },
      { source: '/api/:path*', destination: 'https://suiyuan-staging-api.onrender.com/api/:path*' },
      { source: '/:path*', destination: '/index.html' },
    ])
    for (const path of ['/api/:path*', '/__pb/:path*']) {
      const entry = c.headers.find(h => h.source === path)
      expect(entry?.headers).toContainEqual({ key: 'Cache-Control', value: 'private, no-store, max-age=0' })
      expect(entry?.headers).toContainEqual({ key: 'x-vercel-enable-rewrite-caching', value: '0' })
    }
  })
  it('fails closed without staging mode, missing backend and accidental production alias', () => {
    expect(() => createVercelSplitConfig({ ...preview, SUIYUAN_DEPLOY_MODE: undefined })).toThrow(/staging/)
    expect(() => createVercelSplitConfig({ ...preview, SUIYUAN_BACKEND_ORIGIN: '' })).toThrow(/Missing/)
    expect(() => createVercelSplitConfig({ ...preview, VERCEL_ENV: 'production' })).toThrow(/production/)
    expect(createVercelSplitConfig({ ...preview, VERCEL_ENV: 'production', SUIYUAN_ALLOW_PRODUCTION_TARGET: 'yes' }).rewrites).toHaveLength(3)
  })
  it('rejects private, fake, insecure, or credential-bearing proxy destinations', () => {
    for (const value of [
      'http://suiyuan-staging-api.onrender.com',
      'http://localhost:7200', 'https://127.0.0.1:8080', 'https://10.0.0.1',
      'https://example.com', 'https://staging.invalid',
      'https://u:password@suiyuan-staging-api.onrender.com',
      'https://suiyuan-staging-api.onrender.com/api',
      'https://suiyuan-staging-api.onrender.com?token=x',
      'file:///etc/passwd',
    ]) {
      expect(() => validateBackendOrigin(value), value).toThrow()
    }
  })
})
