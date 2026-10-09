import { expect, test } from '@playwright/test'
import { ADMIN_PASS as TEST_PASSWORD } from './global-setup.mjs'

test('手机端完整导航：活动、消息、我的与刷新保持登录', async ({ page, request }) => {
  test.setTimeout(130_000)
  await page.setViewportSize({ width: 390, height: 844 })

  const email = `mobile-${Date.now()}@smoke.test`
  const created = await request.post('/api/collections/users/records', {
    data: {
      email, password: TEST_PASSWORD, passwordConfirm: TEST_PASSWORD,
      name: '移动端测试账号', adultConfirmed: true,
    },
  })
  expect(created.status()).toBe(200)
  const auth = await request.post('/api/collections/users/auth-with-password', {
    data: { identity: email, password: TEST_PASSWORD },
  })
  expect(auth.status()).toBe(200)
  const { token, record } = await auth.json()
  const headers = { Authorization: token as string }

  try {
    await page.goto('/auth', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('邮箱', { exact: true }).fill(email)
    await page.getByLabel('密码', { exact: true }).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: '登录', exact: true }).last().click()
    await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 40_000 })

    const mobile = page.locator('nav.fixed')
    await expect(mobile).toBeVisible({ timeout: 30_000 })
    for (const label of ['推荐', '活动', '消息', '我的']) {
      await expect(mobile.getByRole('link', { name: label, exact: true })).toBeVisible()
    }

    await mobile.getByRole('link', { name: '活动', exact: true }).click()
    await expect(page).toHaveURL(/\/events$/, { timeout: 30_000 })
    await expect(mobile).toBeVisible()

    await mobile.getByRole('link', { name: '消息', exact: true }).click()
    await expect(page).toHaveURL(/\/matches$/, { timeout: 30_000 })
    await expect(page.getByText('暂无佳音')).toBeVisible({ timeout: 25_000 })

    await mobile.getByRole('link', { name: '我的', exact: true }).click()
    await expect(page).toHaveURL(/\/me$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: '打理自己的缘' })).toBeVisible({ timeout: 30_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '打理自己的缘' })).toBeVisible({ timeout: 35_000 })
    await expect(mobile).toBeVisible()
    await expect(page.getByText('页面渲染出错', { exact: false })).toHaveCount(0)
  } finally {
    await request.delete(`/api/collections/users/records/${record.id}`, { headers }).catch(() => {})
  }
})
