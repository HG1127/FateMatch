// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { authorizationHeaders } from './pb-auth'
import { getPocketBaseUrl, pb, pbAuthHeader } from './pb'

describe('独立版同源 API 与鉴权', () => {
  it('以当前站点 origin 访问 /api，不再生成子路径或 /__pb', () => {
    expect(getPocketBaseUrl()).toBe(window.location.origin)
    expect(pb.buildURL('/api/collections/users/records'))
      .toBe(`${window.location.origin}/api/collections/users/records`)
    expect(pb.baseURL).not.toContain('__pb')
  })

  it('统一使用 Authorization，不依赖平台私有 X-Pb-Auth', () => {
    expect(authorizationHeaders('token-1')).toEqual({ Authorization: 'token-1' })
    expect(pbAuthHeader('token-2')).toEqual({ Authorization: 'token-2' })
    expect(JSON.stringify(authorizationHeaders('abc'))).not.toContain('X-Pb-Auth')
  })

  it('无 token 时不会附加认证头', () => {
    expect(authorizationHeaders('')).toEqual({})
    expect(authorizationHeaders(null)).toEqual({})
  })

  it('沿用原独立版认证存储，不依赖 VibeX App ID', () => {
    expect(pb.authStore).toBeDefined()
  })
})
