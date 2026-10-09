// Secure client address resolution for rate limits and security logs.
import { isIP } from 'node:net'

export function canonicalIp(value) {
  let address = String(value ?? '').trim()
  if (address.startsWith('::ffff:')) address = address.slice('::ffff:'.length)
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1)
  return isIP(address) ? address.toLowerCase() : ''
}

// Only explicitly configured immediate proxy peers may supply a single client IP.
// Proxies must overwrite X-Forwarded-For (never append an incoming client header).
export function createClientIpResolver(trustedProxyIps = []) {
  const trusted = new Set()
  for (const item of trustedProxyIps) {
    const ip = canonicalIp(item)
    if (!ip) throw new Error('TRUSTED_PROXY_IPS 包含无效 IP，仅允许明确的 IPv4/IPv6 地址')
    trusted.add(ip)
  }
  return (req) => {
    const remote = canonicalIp(req.socket?.remoteAddress) || 'unknown'
    if (!trusted.has(remote)) return remote
    const raw = req.headers?.['x-forwarded-for']
    if (typeof raw !== 'string' || raw.includes(',')) return remote
    return canonicalIp(raw) || remote
  }
}
