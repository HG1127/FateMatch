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

test.describe('计数拆分与权限收紧', () => {
  const ADMIN_EMAIL = 'admin@smoke.test'
  const ADMIN_PASS = 'Admin#2026x'

  test('主表仅作者/发起人可改，计数走独立表，不可自我提权', async ({ request }) => {
    const stamp = Date.now()
    const mailA = `cnt-a-${stamp}@smoke.test`
    const mailB = `cnt-b-${stamp}@smoke.test`
    const regA = await request.post('/api/collections/users/records', {
      data: { email: mailA, password: PASS, passwordConfirm: PASS, name: '计数甲' },
    })
    const regB = await request.post('/api/collections/users/records', {
      data: { email: mailB, password: PASS, passwordConfirm: PASS, name: '计数乙' },
    })
    expect(regA.status()).toBe(200)
    expect(regB.status()).toBe(200)
    const loginA = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mailA, password: PASS } })).json()
    const loginB = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mailB, password: PASS } })).json()
    const HA = { Authorization: loginA.token }
    const HB = { Authorization: loginB.token }
    const aId = loginA.record.id
    const bId = loginB.record.id

    // 甲发帖；乙改甲的帖子被拒（收紧前这里曾是 200）
    const postSid = `e2e-c-post-${stamp}`
    const post = await request.post('/api/collections/posts/records', {
      headers: HA,
      data: { sid: postSid, author_sid: aId, text: '甲的动态', images: [], topic: '', featured: false, at: stamp },
    })
    expect(post.status()).toBe(200)
    const postId = (await post.json()).id
    const hijack = await request.patch(`/api/collections/posts/records/${postId}`, {
      headers: HB,
      data: { text: '被乙篡改', featured: true },
    })
    expect(hijack.status()).toBe(403)

    // 自我提权被字段级拦截：乙给自己建资料行塞 role=admin，落库后仍是普通成员
    const prof = await request.post('/api/collections/profiles/records', {
      headers: HB,
      data: { sid: bId, nickname: '乙', role: 'admin', banned: false },
    })
    expect(prof.status()).toBe(200)
    expect((await prof.json()).role).not.toBe('admin')
    const adminLogs = await request.get('/api/collections/admin_logs/records', { headers: HB })
    expect(adminLogs.status()).toBe(403)

    // 点赞走独立表：乙给自己的点赞行建档 OK，冒充甲被拒，匿名可读，甲不能删乙的行
    const likeSid = `post:${postSid}:${bId}`
    const like = await request.post('/api/collections/content_likes/records', {
      headers: HB,
      data: { sid: likeSid, kind: 'post', target_sid: postSid, owner_sid: bId },
    })
    expect(like.status()).toBe(200)
    const likeId = (await like.json()).id
    const forge = await request.post('/api/collections/content_likes/records', {
      headers: HB,
      data: { sid: `post:${postSid}:${aId}`, kind: 'post', target_sid: postSid, owner_sid: aId },
    })
    expect(forge.status()).toBe(403)
    const anonLikes = await request.get('/api/collections/content_likes/records')
    expect(anonLikes.status()).toBe(200)
    const delByOther = await request.delete(`/api/collections/content_likes/records/${likeId}`, { headers: HA })
    expect(delByOther.status()).toBe(403)
    const delOwn = await request.delete(`/api/collections/content_likes/records/${likeId}`, { headers: HB })
    expect(delOwn.status()).toBe(204)

    // 活动：乙建活动并报名；留言作者可删自己的留言，活动发起人可置顶他人留言
    const evSid = `e2e-c-ev-${stamp}`
    const ev = await request.post('/api/collections/events/records', {
      headers: HB,
      data: { sid: evSid, title: '乙的活动', city: '杭州', region: '', cover: '', date: '2026-10-01', time: '19:00', capacity: 2, desc: '', tags: [], host: '乙', creator_sid: bId, requirements: '', pinned: false, images: [] },
    })
    expect(ev.status()).toBe(200)
    const evId = (await ev.json()).id
    const join = await request.post('/api/collections/event_attendees/records', {
      headers: HB,
      data: { sid: `${evSid}:${bId}`, event_sid: evSid, owner_sid: bId },
    })
    expect(join.status()).toBe(200)
    const ecSid = `e2e-c-ec-${stamp}`
    const ec = await request.post('/api/collections/event_comments/records', {
      headers: HA,
      data: { sid: ecSid, event_sid: evSid, author_sid: aId, text: '甲的留言', pinned: false, at: stamp },
    })
    expect(ec.status()).toBe(200)
    const ecId = (await ec.json()).id
    const pinByCreator = await request.patch(`/api/collections/event_comments/records/${ecId}`, {
      headers: HB,
      data: { pinned: true },
    })
    expect(pinByCreator.status()).toBe(200)
    const delOwnComment = await request.delete(`/api/collections/event_comments/records/${ecId}`, { headers: HA })
    expect(delOwnComment.status()).toBe(204)
    const delEvByOther = await request.delete(`/api/collections/events/records/${evId}`, { headers: HA })
    expect(delEvByOther.status()).toBe(403)
    const delOwnEvent = await request.delete(`/api/collections/events/records/${evId}`, { headers: HB })
    expect(delOwnEvent.status()).toBe(204)

    // 精选：成员建/改被拒；浏览计数走原子端点（匿名 403，登录 +1）
    const dgSid = `e2e-c-dg-${stamp}`
    const memberDigest = await request.post('/api/collections/digests/records', {
      headers: HB,
      data: { sid: dgSid, title: '乙的精选', intro: '', post_sids: [], issue: 1, at: stamp },
    })
    expect(memberDigest.status()).toBe(403)
    const adminLogin = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: ADMIN_EMAIL, password: ADMIN_PASS } })).json()
    const HAdmin = { Authorization: adminLogin.token }
    const dg = await request.post('/api/collections/digests/records', {
      headers: HAdmin,
      data: { sid: dgSid, title: '掌柜精选', intro: '', post_sids: [postSid], issue: 1, at: stamp },
    })
    expect(dg.status()).toBe(200)
    const anonView = await request.post(`/api/collections/digests/records/${dgSid}/view`)
    expect(anonView.status()).toBe(403)
    const view1 = await request.post(`/api/collections/digests/records/${dgSid}/view`, { headers: HB })
    expect(view1.status()).toBe(200)
    expect((await view1.json()).views).toBe(1)
    const view2 = await request.post(`/api/collections/digests/records/${dgSid}/view`, { headers: HB })
    expect((await view2.json()).views).toBe(2)

    // 清理
    expect((await request.delete(`/api/collections/users/records/${aId}`, { headers: HA })).status()).toBe(204)
    expect((await request.delete(`/api/collections/users/records/${bId}`, { headers: HB })).status()).toBe(204)
  })
})

test.describe('满员校验与跨行读收紧', () => {
  test('报名满员被服务端拦截；名片/签到仅本人与发起人可读', async ({ request }) => {
    test.setTimeout(180_000) // 请求数多且外网出口偶发抖动，放宽时限
    const stamp = Date.now()
    const reg = async (tag: string, name: string) => {
      const mail = `${tag}-${stamp}@smoke.test`
      const r = await request.post('/api/collections/users/records', {
        data: { email: mail, password: PASS, passwordConfirm: PASS, name },
      })
      expect(r.status()).toBe(200)
      const login = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })).json()
      return { H: { Authorization: login.token }, id: login.record.id }
    }
    const host = await reg('cap-host', '主办丙')
    const guest = await reg('cap-guest', '客丁')
    const third = await reg('cap-third', '客戊')

    // 容量 2 的活动：主办 + 1 名客人后满员
    const evSid = `e2e-cap-${stamp}`
    const ev = await request.post('/api/collections/events/records', {
      headers: host.H,
      data: { sid: evSid, title: '满员测试场', city: '杭州', region: '', cover: '', date: '2026-10-01', time: '19:00', capacity: 2, desc: '', tags: [], host: '丙', creator_sid: host.id, requirements: '', pinned: false, images: [] },
    })
    expect(ev.status()).toBe(200)
    const joinHost = await request.post('/api/collections/event_attendees/records', {
      headers: host.H,
      data: { sid: `${evSid}:${host.id}`, event_sid: evSid, owner_sid: host.id },
    })
    expect(joinHost.status()).toBe(200)
    const joinGuest = await request.post('/api/collections/event_attendees/records', {
      headers: guest.H,
      data: { sid: `${evSid}:${guest.id}`, event_sid: evSid, owner_sid: guest.id },
    })
    expect(joinGuest.status()).toBe(200)
    // 第三个名额：服务端拦截（此前只在客户端校验，直连接口可超员）
    const joinThird = await request.post('/api/collections/event_attendees/records', {
      headers: third.H,
      data: { sid: `${evSid}:${third.id}`, event_sid: evSid, owner_sid: third.id },
    })
    expect(joinThird.status()).toBe(400)
    expect((await joinThird.json()).data.capacity.message).toBeTruthy()
    // 已报名者重复提交幂等返回，不算新增
    const rejoin = await request.post('/api/collections/event_attendees/records', {
      headers: guest.H,
      data: { sid: `${evSid}:${guest.id}`, event_sid: evSid, owner_sid: guest.id },
    })
    expect(rejoin.status()).toBe(200)
    // 客人退订后名额释放
    const leaveId = (await joinGuest.json()).id
    expect((await request.delete(`/api/collections/event_attendees/records/${leaveId}`, { headers: guest.H })).status()).toBe(204)
    const joinThirdRetry = await request.post('/api/collections/event_attendees/records', {
      headers: third.H,
      data: { sid: `${evSid}:${third.id}`, event_sid: evSid, owner_sid: third.id },
    })
    expect(joinThirdRetry.status()).toBe(200)

    // 名片：客人留联系方式；无关成员的列表里看不到，发起人看得到
    const contact = await request.post('/api/collections/contacts/records', {
      headers: third.H,
      data: { sid: `${evSid}:${third.id}`, event_sid: evSid, user_sid: third.id, text: 'wechat-123' },
    })
    expect(contact.status()).toBe(200)
    const guestContacts = await request.get('/api/collections/contacts/records', { headers: guest.H })
    expect(guestContacts.status()).toBe(200)
    expect((await guestContacts.json()).items.some((i: { user_sid: string }) => i.user_sid === third.id)).toBe(false)
    const hostContacts = await request.get('/api/collections/contacts/records', { headers: host.H })
    expect((await hostContacts.json()).items.some((i: { user_sid: string }) => i.user_sid === third.id)).toBe(true)
    // 冒充他人写名片被拒
    const forgeContact = await request.post('/api/collections/contacts/records', {
      headers: guest.H,
      data: { sid: `${evSid}:${third.id}`, event_sid: evSid, user_sid: third.id, text: 'hacked' },
    })
    expect(forgeContact.status()).toBe(403)

    // 签到：本人可写可读；无关成员列表不可见；冒充被拒
    const ci = await request.post('/api/collections/checkins/records', {
      headers: third.H,
      data: { sid: `${third.id}:${evSid}`, owner_sid: third.id, event_sid: evSid },
    })
    expect(ci.status()).toBe(200)
    const forgeCheckin = await request.post('/api/collections/checkins/records', {
      headers: guest.H,
      data: { sid: `${third.id}:${evSid}x`, owner_sid: third.id, event_sid: evSid },
    })
    expect(forgeCheckin.status()).toBe(403)
    const guestCheckins = await request.get('/api/collections/checkins/records', { headers: guest.H })
    expect((await guestCheckins.json()).items.some((i: { owner_sid: string }) => i.owner_sid === third.id)).toBe(false)
    const hostCheckins = await request.get('/api/collections/checkins/records', { headers: host.H })
    expect((await hostCheckins.json()).items.some((i: { owner_sid: string }) => i.owner_sid === third.id)).toBe(true)

    // 清理
    expect((await request.delete(`/api/collections/users/records/${host.id}`, { headers: host.H })).status()).toBe(204)
    expect((await request.delete(`/api/collections/users/records/${guest.id}`, { headers: guest.H })).status()).toBe(204)
    expect((await request.delete(`/api/collections/users/records/${third.id}`, { headers: third.H })).status()).toBe(204)
  })
})

test.describe('输入尺寸护栏', () => {
  test('超长文本与超量数组被服务端字段级拦截', async ({ request }) => {
    test.setTimeout(120_000)
    const stamp = Date.now()
    const mail = `lim-${stamp}@smoke.test`
    const reg = await request.post('/api/collections/users/records', {
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '护栏员' },
    })
    expect(reg.status()).toBe(200)
    const login = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })).json()
    const H = { Authorization: login.token }
    const myId = login.record.id

    // 超长正文（上限 5000 字）→ 字段级 400
    const long = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-lim-${stamp}`, author_sid: myId, text: '缘'.repeat(5001), images: [], topic: '', featured: false, at: stamp },
    })
    expect(long.status()).toBe(400)
    expect((await long.json()).data.text.message).toBeTruthy()

    // 超量配图（上限 9 张）→ 字段级 400
    const manyImgs = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-lim2-${stamp}`, author_sid: myId, text: '正常文字', images: Array.from({ length: 10 }, (_, i) => `data:,${i}`), topic: '', featured: false, at: stamp },
    })
    expect(manyImgs.status()).toBe(400)
    expect((await manyImgs.json()).data.images.message).toBeTruthy()

    // 正常尺寸不受影响
    const ok = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-lim3-${stamp}`, author_sid: myId, text: '正常长度的分享', images: ['data:,0'], topic: '', featured: false, at: stamp },
    })
    expect(ok.status()).toBe(200)

    // 清理
    expect((await request.delete(`/api/collections/users/records/${myId}`, { headers: H })).status()).toBe(204)
  })
})

test.describe('登录防爆破', () => {
  test('同一邮箱连续错 8 次密码后临时锁定，锁定期正确密码也被拒', async ({ request }) => {
    test.setTimeout(180_000)
    const stamp = Date.now()
    const mail = `brute-${stamp}@smoke.test`
    const reg = await request.post('/api/collections/users/records', {
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '防爆破员' },
    })
    expect(reg.status()).toBe(200)
    // 先成功登录拿清理用 token（成功登录会清零失败计数）
    const login0 = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })).json()
    const H = { Authorization: login0.token }
    // 连续 8 次错密码 → 每次 400
    for (let i = 0; i < 8; i++) {
      const bad = await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: 'wrong-pass-1' } })
      expect(bad.status()).toBe(400)
    }
    // 第 9 次：锁定期内，正确密码也被 429 拒绝
    const locked = await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })
    expect(locked.status()).toBe(429)
    expect((await locked.json()).message).toContain('分钟')
    // 锁定按邮箱隔离：其他账号登录不受影响
    const mail2 = `brute2-${stamp}@smoke.test`
    const reg2 = await request.post('/api/collections/users/records', { data: { email: mail2, password: PASS, passwordConfirm: PASS, name: '防爆破乙' } })
    expect(reg2.status()).toBe(200)
    const login2 = await request.post('/api/collections/users/auth-with-password', { data: { identity: mail2, password: PASS } })
    expect(login2.status()).toBe(200)
    // 清理（锁定只影响登录接口，持 token 的删除不受影响）
    const l2 = await login2.json()
    expect((await request.delete(`/api/collections/users/records/${login0.record.id}`, { headers: H })).status()).toBe(204)
    expect((await request.delete(`/api/collections/users/records/${l2.record.id}`, { headers: { Authorization: l2.token } })).status()).toBe(204)
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
