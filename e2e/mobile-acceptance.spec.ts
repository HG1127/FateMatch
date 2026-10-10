import { expect, test } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASS } from './global-setup.mjs'

// Mobile Chromium browser + touch emulation, not physical Android/iPhone Safari.
// Accounts and all page content are from the disposable e2e_smoke schema.
const devices = [
  { name: 'small-touch-320', width: 320, height: 568 },
  { name: 'phone-touch-375', width: 375, height: 812 },
  { name: 'android-touch-390', width: 390, height: 844 },
  { name: 'large-touch-430', width: 430, height: 932 },
  { name: 'tablet-touch-768', width: 768, height: 1024 },
]

for (const device of devices) {
  test(`触控屏布局验收 ${device.name}：注册登录入口、导航、隐私和主要页面`, async ({ browser }) => {
    test.setTimeout(105_000)
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const base = 'http://127.0.0.1:7200'

    async function checkWidth(label: string) {
      const info = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
      expect(Math.max(info.doc, info.body), `${device.name} ${label} ${JSON.stringify(info)}`)
        .toBeLessThanOrEqual(info.viewport + 2)
      await expect(page.getByText('页面渲染出错', { exact: false })).toHaveCount(0)
    }

    try {
      await page.goto(base + '/auth', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: '别来无恙' })).toBeVisible()
      await checkWidth('auth')
      if (device.width < 768) {
        const fontSize = await page.getByLabel('邮箱', { exact: true }).evaluate(el => getComputedStyle(el).fontSize)
        expect(fontSize, '手机输入框必须至少 16px 防止 Safari 自动放大').toBe('16px')
        await page.getByRole('button', { name: '打开更多功能' }).tap()
        await expect(page.getByRole('dialog', { name: '发现更多' })).toBeVisible()
        await page.getByRole('button', { name: '关闭更多功能菜单' }).tap()
      }
      await page.getByLabel('邮箱', { exact: true }).fill(ADMIN_EMAIL)
      await page.getByLabel('密码', { exact: true }).fill(ADMIN_PASS)
      await page.getByRole('button', { name: '登录', exact: true }).last().tap()
      await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 30_000 })
      await checkWidth('home')

      const mobileNav = page.locator('nav.fixed')
      if (device.width < 768) {
        await expect(mobileNav).toBeVisible()
        await page.getByRole('button', { name: '打开更多功能' }).tap()
        await expect(page.getByRole('navigation', { name: '手机更多功能' })).toBeVisible()
        await expect(page.getByRole('link', { name: /兴趣筛选/ }).last()).toBeVisible()
        await page.getByRole('button', { name: '关闭更多功能菜单' }).tap()
        for (const label of ['推荐', '活动', '消息', '我的']) {
          await expect(mobileNav.getByRole('link', { name: label, exact: true })).toBeVisible()
        }
        await mobileNav.getByRole('link', { name: '活动', exact: true }).tap()
        await expect(page).toHaveURL(/\/events$/, { timeout: 20_000 })
        await checkWidth('events')
        await mobileNav.getByRole('link', { name: '消息', exact: true }).tap()
        await expect(page).toHaveURL(/\/matches$/, { timeout: 20_000 })
        await checkWidth('matches')
        await mobileNav.getByRole('link', { name: '我的', exact: true }).tap()
      } else {
        await expect(mobileNav).toBeHidden()
        await page.goto(base + '/me')
      }

      await expect(page.getByRole('heading', { name: '打理自己的缘' })).toBeVisible({ timeout: 30_000 })
      await checkWidth('me')
      await page.screenshot({ path: test.info().outputPath(device.name + '-me.png') })
      await page.goto(base + '/trust')
      await expect(page.getByRole('heading', { name: '安全与隐私说明' })).toBeVisible()
      await checkWidth('trust')
      await page.goto(base + '/explore')
      await expect(page.getByRole('heading', { name: '寻一位知音' })).toBeVisible()
      await checkWidth('explore')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: '寻一位知音' })).toBeVisible({ timeout: 30_000 })
      await checkWidth('refresh')
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
}
