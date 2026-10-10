import { expect, test } from '@playwright/test'

test('独立版不加载 VibeX/境外字体并使用标准同源 API', async ({ page, request }) => {
  const apiRequests: string[] = []
  const blockedRequests: string[] = []
  page.on('request', req => {
    const url = new URL(req.url())
    if (url.pathname.includes('/__pb/')) blockedRequests.push(url.pathname)
    if (/vibex\.runninghub\.cn|\.vibex\.cn|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname)) {
      blockedRequests.push(req.url())
    }
    if (url.pathname.startsWith('/api/collections/')) apiRequests.push(url.pathname)
  })

  await page.goto('/auth', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible({ timeout: 25_000 })
  await expect.poll(() => apiRequests.length, { timeout: 30_000 }).toBeGreaterThan(0)

  const ready = await request.get('/api/ready')
  expect(ready.status()).toBe(200)
  // The old compatibility endpoint stays available for rollback only.
  const legacy = await request.get('/__pb/api/health')
  expect(legacy.status()).toBe(200)

  expect(blockedRequests).toEqual([])
})
