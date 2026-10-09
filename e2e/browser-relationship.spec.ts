import { test, expect } from '@playwright/test'

// 真实浏览器闭环：仅在临时 Neon schema 创建两名隔离测试会员。
// 人物/互有意的前置数据通过受保护 API 准备，聊天和关系反馈必须通过前端真实操作。
test('完整前后端：互配后首次发信即出现本人反馈，并且刷新后仍可见', async ({ page, request }) => {
  test.setTimeout(210_000)
  const password = 'Smoke#2026x'
  const stamp = Date.now()

  const createMember = async (suffix: string, nickname: string, gender: string, seeking: string) => {
    const email = `browser-pair-${suffix}-${stamp}@smoke.test`
    const created = await request.post('/api/collections/users/records', {
      data: { email, password, passwordConfirm: password, name: nickname, adultConfirmed: true },
    })
    expect(created.status()).toBe(200)

    const signedIn = await request.post('/api/collections/users/auth-with-password', {
      data: { identity: email, password },
    })
    expect(signedIn.status()).toBe(200)
    const { token, record } = await signedIn.json()
    const headers = { Authorization: token as string }
    const profile = await request.post('/api/collections/profiles/records', {
      headers,
      data: {
        sid: record.id, nickname, gender, seeking, birth_date: '1990-01-01',
        city: '杭州', region: '', height: 0, job: '',
        bio: '通过独立测试验证真正的关系闭环',
        interests: ['阅读', '旅行', '徒步'], photos: [],
        verification: { phone: false, realname: false, photo: false },
        stealth: false, badge_dates: {}, created_at: Date.now(),
      },
    })
    expect(profile.status()).toBe(200)
    return { id: record.id as string, email, headers }
  }

  let a: Awaited<ReturnType<typeof createMember>> | null = null
  let b: Awaited<ReturnType<typeof createMember>> | null = null
  try {
    a = await createMember('a', '浏览器甲', 'female', 'male')
    b = await createMember('b', '浏览器乙', 'male', 'female')

    for (const [owner, target] of [[a, b], [b, a]] as const) {
      const liked = await request.post('/api/collections/user_likes/records', {
        headers: owner.headers,
        data: { sid: `${owner.id}:${target.id}`, owner_sid: owner.id, target_sid: target.id },
      })
      expect(liked.status()).toBe(200)
    }

    // 从真实注册登录页进入，验证浏览器的会话/Store/按需资料链路。
    await page.goto('/auth', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('邮箱', { exact: true }).fill(a.email)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录', exact: true }).last().click()
    await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 35_000 })

    // 用站内深链接打开已经互配的对象，不用 mock UI 数据。
    await page.goto(`/matches?with=${encodeURIComponent(b.id)}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '往来与佳音' })).toBeVisible({ timeout: 50_000 })
    await expect(page.getByPlaceholder('写一句问候…')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('button', { name: '愿意继续认识' })).toHaveCount(0)

    const message = `首次真人问候-${stamp}`
    await page.getByPlaceholder('写一句问候…').fill(message)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText(message, { exact: true }).last()).toBeVisible({ timeout: 25_000 })

    // 关键 UI 回归：首次成功发信无需刷新，反馈入口立即可见。
    await expect(page.getByRole('button', { name: '愿意继续认识' })).toBeVisible({ timeout: 25_000 })
    // 同名“撤回”也用于消息，不能据此推断反馈已落库。必须等真实 PUT 成功。
    const saved = page.waitForResponse(response =>
      response.url().includes(`/api/me/relationship-feedback/${b.id}`) &&
      response.request().method() === 'PUT', { timeout: 30_000 })
    await page.getByRole('button', { name: '愿意继续认识' }).click()
    const writeResponse = await saved
    expect(writeResponse.status()).toBe(200)
    expect(await writeResponse.json()).toMatchObject({ eligible: true, outcome: 'continue' })
    await expect(page.getByRole('button', { name: '愿意继续认识' })).toHaveClass(/bg-primary/, { timeout: 25_000 })
    await expect(page.getByRole('button', { name: '撤回', exact: true }).last()).toBeVisible({ timeout: 25_000 })

    const own = await request.get(`/api/me/relationship-feedback/${b.id}`, { headers: a.headers })
    expect(own.status()).toBe(200)
    expect(await own.json()).toMatchObject({ eligible: true, outcome: 'continue' })
    const theirs = await request.get(`/api/me/relationship-feedback/${a.id}`, { headers: b.headers })
    expect(theirs.status()).toBe(200)
    expect(await theirs.json()).toMatchObject({ outcome: null })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(message, { exact: true }).last()).toBeVisible({ timeout: 40_000 })
    await expect(page.getByRole('button', { name: '愿意继续认识' })).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('button', { name: '撤回', exact: true }).last()).toBeVisible({ timeout: 25_000 })
  } finally {
    // 隔离用户只存在于 E2E 临时 schema，仍尽力主动清理减少测试状态污染。
    if (a) await request.delete(`/api/collections/users/records/${a.id}`, { headers: a.headers }).catch(() => {})
    if (b) await request.delete(`/api/collections/users/records/${b.id}`, { headers: b.headers }).catch(() => {})
  }
})
