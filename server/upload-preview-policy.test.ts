import { describe, it, expect } from 'vitest'
import { mayStoreUpload } from './upload-preview-policy.mjs'

describe('preview upload persistence guard', () => {
  it('disables uploads on explicitly ephemeral free preview', () => {
    expect(mayStoreUpload({ STAGING_MODE: '1', SUIYUAN_EPHEMERAL_PREVIEW: '1' })).toBe(false)
  })
  it('leaves durable staging/production and disposable e2e upload behavior unchanged', () => {
    expect(mayStoreUpload({ STAGING_MODE: '1', SUIYUAN_EPHEMERAL_PREVIEW: '0' })).toBe(true)
    expect(mayStoreUpload({ NEON_SCHEMA: 'e2e_smoke_x' })).toBe(true)
    expect(mayStoreUpload({ SUIYUAN_EPHEMERAL_PREVIEW: '1' })).toBe(true)
  })
})
