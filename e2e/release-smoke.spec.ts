// 发布冒烟主链路：注册 → 登录 → 发帖 → 属主隔离 → 权限拦截 → 注销清理，
// 全部跑在隔离 schema 的测试网关上；另加一条 8000 页面服务的只读启动检查。
import { test, expect } from '@playwright/test'

const EMAIL = `e2e-${Date.now()}@smoke.test`
const PASS = 'Smoke#2026x'

test.describe('数据网关主链路', () => {
  test('注册：短密码与不一致被字段级拦截', async ({ request }) => {
    const short = await request.post('/api/collections/users/records', {
      data: { email: EMAIL, password: '123', passwordConfirm: '123' },
    })
    expect(short.status()).toBe(400)
    expect((await short.json()).data.password.message).toBeTruthy()

    const mismatch = await request.post('/api/collections/users/records', {
      data: { email: EMAIL, password: PASS, passwordConfirm: 'other#12345' },
    })
    expect(mismatch.status()).toBe(400)
    expect((await mismatch.json()).data.passwordConfirm.message).toBeTruthy()
  })

  test('注册 → 登录 → 发帖 → 属主规则 → 清理', async ({ request }) => {
    // 注册
    const reg = await request.post('/api/collections/users/records', {
      data: { email: EMAIL, password: PASS, passwordConfirm: PASS, name: '冒烟员' },
    })
    expect(reg.status()).toBe(200)
    const dup = await request.post('/api/collections/users/records', {
      data: { email: EMAIL, password: PASS, passwordConfirm: PASS },
    })
    expect(dup.status()).toBe(400)

    // 登录
    const login = await request.post('/api/collections/users/auth-with-password', {
      data: { identity: EMAIL, password: PASS },
    })
    expect(login.status()).toBe(200)
    const { token, record } = await login.json()
    expect(token).toBeTruthy()
    const H = { Authorization: token }
    const myId = record.id

    // 错密码被拒
    const bad = await request.post('/api/collections/users/auth-with-password', {
      data: { identity: EMAIL, password: 'wrong-pass-1' },
    })
    expect(bad.status()).toBe(400)

    // 匿名读私有表被拒
    const anonPriv = await request.get('/api/collections/favorites/records')
    expect(anonPriv.status()).toBe(403)

    // 登录后私有表只见自己的（0 条）
    const favs = await request.get('/api/collections/favorites/records', { headers: H })
    expect(favs.status()).toBe(200)
    expect((await favs.json()).totalItems).toBe(0)

    // 发帖（公开表）
    const post = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: 'e2e-post-1', author_sid: myId, text: '冒烟动态', images: [], likes: [], topic: '', featured: false, at: Date.now() },
    })
    expect(post.status()).toBe(200)
    const postId = (await post.json()).id
    const listed = await request.get('/api/collections/posts/records?perPage=100')
    expect((await listed.json()).items.some((i: { sid: string }) => i.sid === 'e2e-post-1')).toBe(true)

    // 改自己的动态
    const upd = await request.patch(`/api/collections/posts/records/${postId}`, {
      headers: H,
      data: { text: '冒烟动态-改' },
    })
    expect(upd.status()).toBe(200)
    expect((await upd.json()).text).toBe('冒烟动态-改')

    // 非管理员删公开内容被拒（删除权在管理员）
    const delForbidden = await request.delete(`/api/collections/posts/records/${postId}`, { headers: H })
    expect(delForbidden.status()).toBe(403)

    // 走访记录：伪造他人身份被拒，本人写入通过且列表只含自己
    const fakeVisit = await request.post('/api/collections/visits/records', {
      headers: H,
      data: { sid: 'e2e-v-fake', viewer_sid: 'not-me', viewed_sid: myId, at: Date.now() },
    })
    expect(fakeVisit.status()).toBe(403)
    const myVisit = await request.post('/api/collections/visits/records', {
      headers: H,
      data: { sid: 'e2e-v-1', viewer_sid: myId, viewed_sid: 'someone', at: Date.now() },
    })
    expect(myVisit.status()).toBe(200)
    const visits = await request.get('/api/collections/visits/records', { headers: H })
    const vItems = (await visits.json()).items
    expect(vItems.length).toBe(1)
    expect(vItems[0].viewer_sid).toBe(myId)

    // 改密码：旧密码错误被拒 → 正确改密后用新密码登录
    const badOld = await request.patch(`/api/collections/users/records/${myId}`, {
      headers: H,
      data: { oldPassword: 'nope-12345', password: 'NewPass#2026', passwordConfirm: 'NewPass#2026' },
    })
    expect(badOld.status()).toBe(400)
    const chg = await request.patch(`/api/collections/users/records/${myId}`, {
      headers: H,
      data: { oldPassword: PASS, password: 'NewPass#2026', passwordConfirm: 'NewPass#2026' },
    })
    expect(chg.status()).toBe(200)
    const relogin = await request.post('/api/collections/users/auth-with-password', {
      data: { identity: EMAIL, password: 'NewPass#2026' },
    })
    expect(relogin.status()).toBe(200)

    // 会话刷新
    const reloginBody = await relogin.json()
    const refresh = await request.post('/api/collections/users/auth-refresh', {
      headers: { Authorization: reloginBody.token },
    })
    expect(refresh.status()).toBe(200)

    // 清理：删除自己的账号（规则允许本人）
    const del = await request.delete(`/api/collections/users/records/${myId}`, {
      headers: { Authorization: reloginBody.token },
    })
    expect(del.status()).toBe(204)
  })
})

test.describe('页面服务启动检查（只读）', () => {
  test('首页可渲染且无崩溃', async ({ page }) => {
    await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).not.toHaveText('')
    await expect(page.getByText('页面渲染出错', { exact: false })).toHaveCount(0)
  })
})
