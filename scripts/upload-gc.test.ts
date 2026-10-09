import { describe, expect, it } from 'vitest'
import { collectV2References, isManagedV2Upload } from './upload-gc.mjs'

describe('upload-gc 安全策略', () => {
  it('只识别 v2 受管资产，不触碰历史 unsigned 文件', () => {
    expect(isManagedV2Upload('v2-profile-abc123-0123456789abcdef01234567.jpg')).toBe(true)
    expect(isManagedV2Upload('abc123-0123456789abcdef01234567.jpg')).toBe(false)
    expect(isManagedV2Upload('../v2-profile-abc-0123456789abcdef01234567.jpg')).toBe(false)
  })

  it('递归提取 JSON / 文本中的 capability URL 且自动去重', () => {
    const a = 'v2-post-k1-0123456789abcdef01234567.webp'
    const b = 'v2-chat-k2-abcdefabcdefabcdefabcdef.png'
    const refs = collectV2References({
      photos: [`/api/uploads/${a}?sig=abc`, { nested: `看图 /api/uploads/${b}?sig=def` }],
      duplicate: `/api/uploads/${a}?sig=zzz`,
      legacy: '/api/uploads/abc-0123456789abcdef01234567.jpg',
    })
    expect([...refs].sort()).toEqual([a, b].sort())
  })
})
