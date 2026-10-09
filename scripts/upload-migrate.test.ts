import { describe, expect, it } from 'vitest'
import { capabilityUrl, deterministicV2Name, isLegacyUploadName, rewriteLegacyValue } from './upload-migrate.mjs'

describe('upload-migrate 历史图片迁移', () => {
  it('只识别 legacy 文件名，v2 不会再次迁移', () => {
    expect(isLegacyUploadName('abc123-0123456789abcdef01234567.jpg')).toBe(true)
    expect(isLegacyUploadName('v2-profile-abc-0123456789abcdef01234567.jpg')).toBe(false)
    expect(isLegacyUploadName('../abc123-0123456789abcdef01234567.jpg')).toBe(false)
  })

  it('同一 purpose + legacy 生成稳定 v2 名称，不同用途隔离', () => {
    const legacy = 'abc123-0123456789abcdef01234567.jpg'
    const a = deterministicV2Name('profile', legacy)
    const b = deterministicV2Name('profile', legacy)
    const c = deterministicV2Name('chat', legacy)
    expect(a).toBe(b)
    expect(a).toMatch(/^v2-profile-migrate-[a-f0-9]{24}\.jpg$/)
    expect(c).toMatch(/^v2-chat-migrate-[a-f0-9]{24}\.jpg$/)
    expect(c).not.toBe(a)
  })

  it('capability URL 使用与网关一致的 upload:name HMAC 规则', () => {
    const name = 'v2-post-migrate-0123456789abcdef01234567.webp'
    const url = capabilityUrl(name, 'secret')
    expect(url).toMatch(new RegExp(`^/api/uploads/${name.replace('.', '\\.')}\\?sig=[A-Za-z0-9_-]{32}$`))
  })

  it('递归改写 JSON/文本中的 legacy URL，保留 v2 和非上传文本', () => {
    const legacy = 'abc123-0123456789abcdef01234567.jpg'
    const already = 'v2-profile-migrate-abcdefabcdefabcdefabcdef.jpg'
    const input = {
      photos: [
        `/api/uploads/${legacy}`,
        `https://example.test/api/uploads/${legacy}?old=1`,
        `/api/uploads/${already}?sig=keep`,
      ],
      note: '普通文本',
    }
    const out = rewriteLegacyValue(input, 'profile', 'secret')
    expect(out.changed).toBe(true)
    const mapped = [...out.mappings.values()][0]
    expect(mapped.legacyName).toBe(legacy)
    expect(mapped.v2Name).toMatch(/^v2-profile-migrate-/)
    expect(out.value.photos[0]).toBe(mapped.url)
    expect(out.value.photos[1]).toBe(`https://example.test${mapped.url}`)
    expect(out.value.photos[2]).toBe(`/api/uploads/${already}?sig=keep`)
    expect(out.value.note).toBe('普通文本')
    expect(out.mappings.size).toBe(1)
  })
})
