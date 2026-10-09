import { expect, test } from '@playwright/test'
import { ADMIN_PASS as TEST_PASSWORD } from './global-setup.mjs'

// Only uses disposable Neon E2E accounts, never public.
test('账号注销与已读更新并发：无服务器内部错误', async ({ request }) => {
  test.setTimeout(180_000)
  for (let round = 0; round < 2; round++) {
    const email = `race-${Date.now()}-${round}@smoke.test`
    const created = await request.post('/api/collections/users/records', {
      data: { email, password: TEST_PASSWORD, passwordConfirm: TEST_PASSWORD, adultConfirmed: true },
    })
    expect(created.status()).toBe(200)
    const auth = await request.post('/api/collections/users/auth-with-password', {
      data: { identity: email, password: TEST_PASSWORD },
    })
    expect(auth.status()).toBe(200)
    const record = await auth.json()
    const id = String(record.record.id)
    const headers = { Authorization: String(record.token) }
    const read = await request.post('/api/collections/user_reads/records', {
      headers,
      data: { sid: `${id}:other-smoke`, owner_sid: id, other_sid: 'other-smoke', at: Date.now() },
    })
    expect(read.status()).toBe(200)
    const item = await read.json()
    const [patch, remove] = await Promise.all([
      request.patch(`/api/collections/user_reads/records/${item.id}`, { headers, data: { at: Date.now() + 1 } }),
      request.delete(`/api/collections/users/records/${id}`, { headers }),
    ])
    expect(remove.status()).toBe(204)
    expect([200, 401, 403, 404]).toContain(patch.status())
  }
})
