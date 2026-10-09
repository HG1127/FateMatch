import { describe, expect, it } from 'vitest'
import { PB_USER_AUTH_HEADER, pbAuthHeaderForHost } from './pb-auth'

describe('PocketBase 鉴权头路由', () => {
  it('本地直连 host 使用 Authorization', () => {
    expect(pbAuthHeaderForHost('token-1', 'localhost')).toEqual({ Authorization: 'token-1' })
    expect(pbAuthHeaderForHost('token-2', '127.0.0.1')).toEqual({ Authorization: 'token-2' })
    expect(pbAuthHeaderForHost('token-3', '[::1]')).toEqual({ Authorization: 'token-3' })
  })

  it('部署域使用 X-Pb-Auth，避免平台网关误判 PB token', () => {
    expect(pbAuthHeaderForHost('token-1', 'demo.apps.vibex.cn')).toEqual({ [PB_USER_AUTH_HEADER]: 'token-1' })
    expect(pbAuthHeaderForHost('token-2', 'example.com')).toEqual({ [PB_USER_AUTH_HEADER]: 'token-2' })
  })

  it('无 token 时不附加鉴权头', () => {
    expect(pbAuthHeaderForHost('', 'localhost')).toEqual({})
    expect(pbAuthHeaderForHost(null, 'example.com')).toEqual({})
  })
})
