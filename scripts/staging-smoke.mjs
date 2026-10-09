/**
 * Read-only same-origin staging HTTP smoke tests. Does not sign in or modify any data.
 * Only targets loopback HTTP or an explicitly named staging HTTPS origin.
 */
import process from 'node:process'
import assert from 'node:assert/strict'

const origin = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:8081'
const parsed = new URL(origin)
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
if (!((local && parsed.protocol === 'http:') ||
    (parsed.protocol === 'https:' && /(^|\.)staging\./i.test(parsed.hostname)))) {
  throw new Error('只允许本地 HTTP 或名称中显式包含 staging. 的 HTTPS 站点')
}
if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
  throw new Error('预发布地址必须是无凭据的站点根 URL')
}
const base = parsed.origin
async function check(url, type) {
  const result = await fetch(base + url, { signal: AbortSignal.timeout(8_000), redirect: 'manual' })
  assert.equal(result.status, 200, `${url} must return HTTP 200; got ${result.status}`)
  const contentType = result.headers.get('content-type') || ''
  if (type) assert.ok(contentType.includes(type), `${url} expected content-type ${type}`)
  console.log('PASS ' + url + ' HTTP 200')
  return result
}
const health = await check('/api/health', 'application/json')
assert.match(health.headers.get('x-robots-tag') ?? '', /noindex/i, 'staging must refuse indexing')
await check('/api/ready', 'application/json')
await check('/', 'text/html')
await check('/me', 'text/html')
await check('/matches', 'text/html')
const secret = await fetch(base + '/.env', { redirect: 'manual', signal: AbortSignal.timeout(8_000) })
assert.notEqual(secret.status, 200, 'Sensitive paths must not be publicly served')
console.log('PASS /.env is denied')
console.log('staging read-only smoke passed; no user records were created')
