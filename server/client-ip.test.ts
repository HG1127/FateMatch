import { describe, expect, it } from 'vitest'
import { canonicalIp, createClientIpResolver } from './client-ip.mjs'

function req(remoteAddress, forwarded) {
  return { socket: { remoteAddress }, headers: forwarded == null ? {} : { 'x-forwarded-for': forwarded } }
}

describe('网关限流客户端地址可信边界', () => {
  it('默认拒绝伪造转发头，使用真实连接地址', () => {
    const ip = createClientIpResolver()
    expect(ip(req('203.0.113.10', '198.51.100.77'))).toBe('203.0.113.10')
    expect(ip(req('::ffff:127.0.0.1', '1.2.3.4'))).toBe('127.0.0.1')
  })
  it('仅明确可信代理可以提供单一且合法的客户端地址', () => {
    const ip = createClientIpResolver(['127.0.0.1', '::1'])
    expect(ip(req('::ffff:127.0.0.1', '198.51.100.77'))).toBe('198.51.100.77')
    expect(ip(req('::1', '2001:db8::99'))).toBe('2001:db8::99')
    expect(ip(req('203.0.113.10', '198.51.100.77'))).toBe('203.0.113.10')
  })
  it('拒绝多跳拼接、非法和带端口的 IP 文本', () => {
    const ip = createClientIpResolver(['127.0.0.1'])
    for (const spoof of ['8.8.8.8, 203.0.113.1', 'invalid', '1.1.1.1:1234', '']) {
      expect(ip(req('127.0.0.1', spoof))).toBe('127.0.0.1')
    }
  })
  it('兼容 IPv4-mapped IPv6，错误配置必须启动时报错', () => {
    expect(canonicalIp('::ffff:192.0.2.4')).toBe('192.0.2.4')
    expect(canonicalIp('::ffff:invalid')).toBe('')
    expect(() => createClientIpResolver(['*'])).toThrow(/TRUSTED_PROXY_IPS/)
  })
})
