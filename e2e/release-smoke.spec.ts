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

test.describe('后端能力补齐', () => {
  const ADMIN_EMAIL = 'admin@smoke.test'
  const ADMIN_PASS = 'Admin#2026x'

  test('封禁与拉黑的服务端强制：停用即拒、拉黑断私信与心动、私有行不可冒充', async ({ request }) => {
    test.setTimeout(240_000)
    const stamp = Date.now()
    const mailA = `be-a-${stamp}@smoke.test`
    const mailB = `be-b-${stamp}@smoke.test`
    const regA = await request.post('/api/collections/users/records', {
      data: { email: mailA, password: PASS, passwordConfirm: PASS, name: '后端甲' },
    })
    const regB = await request.post('/api/collections/users/records', {
      data: { email: mailB, password: PASS, passwordConfirm: PASS, name: '后端乙' },
    })
    expect(regA.status()).toBe(200)
    expect(regB.status()).toBe(200)
    const loginA = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mailA, password: PASS } })).json()
    const loginB = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mailB, password: PASS } })).json()
    const HA = { Authorization: loginA.token }
    const HB = { Authorization: loginB.token }
    const aId = loginA.record.id
    const bId = loginB.record.id

    // 乙建自己的资料行（掌柜停用的操作对象）
    const profB = await request.post('/api/collections/profiles/records', { headers: HB, data: { sid: bId, nickname: '乙' } })
    expect(profB.status()).toBe(200)
    const profBId = (await profB.json()).id

    // 防冒充：乙给甲建收藏行被拒（收紧前任意成员可写他人私有行）
    const forgeFav = await request.post('/api/collections/favorites/records', {
      headers: HB,
      data: { sid: `${aId}:users:${bId}`, owner_sid: aId, fav_type: 'users', target_sid: bId, group_name: '' },
    })
    expect(forgeFav.status()).toBe(403)

    // 公开表署名冒充（v1.7 收紧）：乙冒甲发动态 / 建活动 / 写评论 / 建资料行，全被拒
    const forgePost = await request.post('/api/collections/posts/records', {
      headers: HB,
      data: { sid: `forge-p-${stamp}`, author_sid: aId, text: '冒充甲的动态', images: [], topic: '', featured: false, at: stamp },
    })
    expect(forgePost.status()).toBe(403)
    const forgeEvent = await request.post('/api/collections/events/records', {
      headers: HB,
      data: { sid: `forge-e-${stamp}`, title: '冒充活动', city: '杭州', region: '', cover: '', date: '2026-10-01', time: '19:00', capacity: 10, desc: '', tags: [], host: '乙', creator_sid: aId, requirements: '', pinned: false, images: [] },
    })
    expect(forgeEvent.status()).toBe(403)
    const forgeComment = await request.post('/api/collections/post_comments/records', {
      headers: HB,
      data: { sid: `forge-c-${stamp}`, post_sid: 'whatever', author_sid: aId, text: '冒充评论', at: stamp },
    })
    expect(forgeComment.status()).toBe(403)
    const forgeProfile = await request.post('/api/collections/profiles/records', {
      headers: HB,
      data: { sid: aId, nickname: '冒充甲' },
    })
    expect(forgeProfile.status()).toBe(403)

    // 甲拉黑乙：乙的私信与心动被服务端拒绝（此前只有客户端过滤）
    const blk = await request.post('/api/collections/blocks/records', {
      headers: HA,
      data: { sid: `${aId}:${bId}`, owner_sid: aId, target_sid: bId },
    })
    expect(blk.status()).toBe(200)
    const blkId = (await blk.json()).id
    const chat = await request.post('/api/collections/chat_messages/records', {
      headers: HB,
      data: { sid: `m-${stamp}`, sid_a: bId, sid_b: aId, from_sid: bId, text: '在吗', images: [], recalled: false, read_at: 0, at: stamp },
    })
    expect(chat.status()).toBe(403)
    const like = await request.post('/api/collections/user_likes/records', {
      headers: HB,
      data: { sid: `${bId}:${aId}`, owner_sid: bId, target_sid: aId },
    })
    expect(like.status()).toBe(403)

    // 解除拉黑后恢复正常
    expect((await request.delete(`/api/collections/blocks/records/${blkId}`, { headers: HA })).status()).toBe(204)
    const chat2 = await request.post('/api/collections/chat_messages/records', {
      headers: HB,
      data: { sid: `m2-${stamp}`, sid_a: bId, sid_b: aId, from_sid: bId, text: '你好呀', images: [], recalled: false, read_at: 0, at: stamp },
    })
    expect(chat2.status()).toBe(200)

    // 停用：掌柜标记后登录被拒、旧令牌全拒；恢复后照常
    const adminLogin = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: ADMIN_EMAIL, password: ADMIN_PASS } })).json()
    const HAdmin = { Authorization: adminLogin.token }

    // 举报处置权（v1.10 收紧）：举报行仅掌柜可改，成员（含被举报人）改被拒
    const rpSid = `rp-${stamp}`
    expect((await request.post('/api/collections/reports/records', { headers: HA, data: { sid: rpSid, by_sid: aId, target_sid: bId, reason: '骚扰', note: '', status: 'open', at: stamp } })).status()).toBe(200)
    const rpList = await (await request.get('/api/collections/reports/records', { headers: HA })).json()
    const rpId = rpList.items.find((i: { sid: string }) => i.sid === rpSid).id
    const rpPatchByMember = await request.patch(`/api/collections/reports/records/${rpId}`, { headers: HB, data: { status: 'done' } })
    expect(rpPatchByMember.status()).toBe(403)
    const rpPatchByAdmin = await request.patch(`/api/collections/reports/records/${rpId}`, { headers: HAdmin, data: { status: 'done' } })
    expect(rpPatchByAdmin.status()).toBe(200)

    const ban = await request.patch(`/api/collections/profiles/records/${profBId}`, { headers: HAdmin, data: { banned: true } })
    expect(ban.status()).toBe(200)
    const loginBanned = await request.post('/api/collections/users/auth-with-password', { data: { identity: mailB, password: PASS } })
    expect(loginBanned.status()).toBe(403)
    const favsBanned = await request.get('/api/collections/favorites/records', { headers: HB })
    expect(favsBanned.status()).toBe(403)
    const unban = await request.patch(`/api/collections/profiles/records/${profBId}`, { headers: HAdmin, data: { banned: false } })
    expect(unban.status()).toBe(200)
    const loginOk = await request.post('/api/collections/users/auth-with-password', { data: { identity: mailB, password: PASS } })
    expect(loginOk.status()).toBe(200)

    // 清理
    expect((await request.delete(`/api/collections/users/records/${aId}`, { headers: HA })).status()).toBe(204)
    expect((await request.delete(`/api/collections/users/records/${bId}`, { headers: { Authorization: (await loginOk.json()).token } })).status()).toBe(204)
  })

  test('掌柜重置密码、邮箱大小写唯一、深度健康检查', async ({ request }) => {
    test.setTimeout(240_000)
    const stamp = Date.now()
    const mailC = `be-c-${stamp}@smoke.test`
    const regC = await request.post('/api/collections/users/records', {
      data: { email: mailC, password: PASS, passwordConfirm: PASS, name: '后端丙' },
    })
    expect(regC.status()).toBe(200)
    const loginC = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mailC, password: PASS } })).json()
    const HC = { Authorization: loginC.token }
    const cId = loginC.record.id
    const adminLogin = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: ADMIN_EMAIL, password: ADMIN_PASS } })).json()
    const HAdmin = { Authorization: adminLogin.token }

    // 成员调管理端点被拒
    const resetByMember = await request.post(`/api/admin/users/${cId}/reset-password`, { headers: HC })
    expect(resetByMember.status()).toBe(403)
    // 掌柜重置：返回一次性临时密码（12 位）
    const reset = await request.post(`/api/admin/users/${cId}/reset-password`, { headers: HAdmin })
    expect(reset.status()).toBe(200)
    const temp = (await reset.json()).tempPassword as string
    expect(temp.length).toBe(12)
    // 旧密码失效，临时密码可登录
    const oldLogin = await request.post('/api/collections/users/auth-with-password', { data: { identity: mailC, password: PASS } })
    expect(oldLogin.status()).toBe(400)
    const tempLogin = await request.post('/api/collections/users/auth-with-password', { data: { identity: mailC, password: temp } })
    expect(tempLogin.status()).toBe(200)

    // 大小写不同的邮箱视为同一邮箱
    const mailM = `Mixed-${stamp}@smoke.test`
    const regM1 = await request.post('/api/collections/users/records', { data: { email: mailM, password: PASS, passwordConfirm: PASS, name: '大小写' } })
    expect(regM1.status()).toBe(200)
    const regM2 = await request.post('/api/collections/users/records', { data: { email: mailM.toLowerCase(), password: PASS, passwordConfirm: PASS, name: '大小写' } })
    expect(regM2.status()).toBe(400)
    expect((await regM2.json()).data.email.message).toBeTruthy()

    // 深度健康检查：额外探测数据库连通性
    const deep = await request.get('/api/health?deep=1')
    expect(deep.status()).toBe(200)
    expect((await deep.json()).data.db).toBe('ok')

    // 清理（临时密码登录后拿到的新令牌）
    const tempTok = (await tempLogin.json()).token
    expect((await request.delete(`/api/collections/users/records/${cId}`, { headers: { Authorization: tempTok } })).status()).toBe(204)
  })
})

test.describe('账号生命周期与附件', () => {
  const ADMIN_EMAIL = 'admin@smoke.test'
  const ADMIN_PASS = 'Admin#2026x'
  const ADMIN_ID = 'e2eadmin0000001'

  test('改密后旧令牌即时失效；上传端点鉴权、读取与类型校验', async ({ request }) => {
    test.setTimeout(180_000)
    const stamp = Date.now()
    const mail = `life-${stamp}@smoke.test`
    const reg = await request.post('/api/collections/users/records', {
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '周期员' },
    })
    expect(reg.status()).toBe(200)
    const login1 = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })).json()
    const H1 = { Authorization: login1.token }
    const myId = login1.record.id

    // 上传：匿名被拒；登录成员拿到不可猜测 URL；GET 可读；非图片类型被拒
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const anonUp = await request.post('/api/uploads', { data: { image: png } })
    expect(anonUp.status()).toBe(403)
    const up = await request.post('/api/uploads', { headers: H1, data: { image: png } })
    expect(up.status()).toBe(200)
    const upBody = await up.json()
    expect(upBody.url).toMatch(/^\/api\/uploads\/[a-z0-9]+-[a-f0-9]{24}\.png$/)
    const fetched = await request.get(upBody.url)
    expect(fetched.status()).toBe(200)
    expect(fetched.headers()['content-type']).toBe('image/png')
    const badType = await request.post('/api/uploads', { headers: H1, data: { image: 'data:text/html;base64,PGI+eDwvYj4=' } })
    expect(badType.status()).toBe(400)
    // 路径穿越被拒
    const traversal = await request.get('/api/uploads/..%2F..%2Fpackage.json')
    expect(traversal.status()).toBe(404)

    // 改密：旧令牌即时 401，新密码登录照常
    const chg = await request.patch(`/api/collections/users/records/${myId}`, {
      headers: H1,
      data: { oldPassword: PASS, password: 'NewLife#2026', passwordConfirm: 'NewLife#2026' },
    })
    expect(chg.status()).toBe(200)
    const stale = await request.get('/api/collections/favorites/records', { headers: H1 })
    expect(stale.status()).toBe(401)
    const login2 = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: 'NewLife#2026' } })).json()
    const H2 = { Authorization: login2.token }
    expect((await request.get('/api/collections/favorites/records', { headers: H2 })).status()).toBe(200)

    // 改邮箱（v1.10 服务端校验）：格式非法与被占用都拒，合法修改后用新邮箱登录
    const badEmail = await request.patch(`/api/collections/users/records/${myId}`, { headers: H2, data: { email: 'not-an-email' } })
    expect(badEmail.status()).toBe(400)
    expect((await badEmail.json()).data.email.message).toBeTruthy()
    const dupEmail = await request.patch(`/api/collections/users/records/${myId}`, { headers: H2, data: { email: ADMIN_EMAIL } })
    expect(dupEmail.status()).toBe(400)
    const mail2 = `life2-${stamp}@smoke.test`
    expect((await request.patch(`/api/collections/users/records/${myId}`, { headers: H2, data: { email: mail2 } })).status()).toBe(200)
    const login3 = await request.post('/api/collections/users/auth-with-password', { data: { identity: mail2, password: 'NewLife#2026' } })
    expect(login3.status()).toBe(200)

    // 清理（用改邮箱后的新令牌）
    expect((await request.delete(`/api/collections/users/records/${myId}`, { headers: { Authorization: (await login3.json()).token } })).status()).toBe(204)
  })

  test('注销账号级联清理本人数据，双方共有的会话保留', async ({ request }) => {
    test.setTimeout(180_000)
    const stamp = Date.now()
    const mail = `gone-${stamp}@smoke.test`
    const reg = await request.post('/api/collections/users/records', {
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '注销员' },
    })
    expect(reg.status()).toBe(200)
    const login = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })).json()
    const H = { Authorization: login.token }
    const eId = login.record.id
    const adminLogin = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: ADMIN_EMAIL, password: ADMIN_PASS } })).json()
    const HAdmin = { Authorization: adminLogin.token }

    // 注销前铺满各类本人数据
    const postSid = `life-p-${stamp}`
    const evSid = `life-e-${stamp}`
    const cSid = `life-c-${stamp}`
    expect((await request.post('/api/collections/profiles/records', { headers: H, data: { sid: eId, nickname: '注销员' } })).status()).toBe(200)
    const postRes = await request.post('/api/collections/posts/records', { headers: H, data: { sid: postSid, author_sid: eId, text: '告别前的分享', images: [], topic: '', featured: false, at: stamp } })
    expect(postRes.status()).toBe(200)
    const postId = (await postRes.json()).id
    expect((await request.post('/api/collections/post_comments/records', { headers: H, data: { sid: cSid, post_sid: postSid, author_sid: eId, text: '自己占一楼', at: stamp } })).status()).toBe(200)
    const evRes = await request.post('/api/collections/events/records', { headers: H, data: { sid: evSid, title: '告别活动', city: '杭州', region: '', cover: '', date: '2026-10-01', time: '19:00', capacity: 5, desc: '', tags: [], host: '注销员', creator_sid: eId, requirements: '', pinned: false, images: [] } })
    expect(evRes.status()).toBe(200)
    const evId = (await evRes.json()).id
    expect((await request.post('/api/collections/event_attendees/records', { headers: H, data: { sid: `${evSid}:${eId}`, event_sid: evSid, owner_sid: eId } })).status()).toBe(200)
    expect((await request.post('/api/collections/content_likes/records', { headers: H, data: { sid: `post:${postSid}:${eId}`, kind: 'post', target_sid: postSid, owner_sid: eId } })).status()).toBe(200)
    expect((await request.post('/api/collections/favorites/records', { headers: H, data: { sid: `${eId}:posts:${postSid}`, owner_sid: eId, fav_type: 'posts', target_sid: postSid, group_name: '' } })).status()).toBe(200)
    const chatSid = `life-m-${stamp}`
    expect((await request.post('/api/collections/chat_messages/records', { headers: H, data: { sid: chatSid, sid_a: eId, sid_b: ADMIN_ID, from_sid: eId, text: '掌柜你好', images: [], recalled: false, read_at: 0, at: stamp } })).status()).toBe(200)

    // 运行指标：匿名与成员被拒，掌柜可读且计数有效
    expect((await request.get('/api/metrics')).status()).toBe(403)
    expect((await request.get('/api/metrics', { headers: H })).status()).toBe(403)
    const met = await request.get('/api/metrics', { headers: HAdmin })
    expect(met.status()).toBe(200)
    const metBody = await met.json()
    expect(metBody.data.requests).toBeGreaterThan(0)
    expect(metBody.data.uptimeSec).toBeGreaterThanOrEqual(0)

    // 内容删除级联（v1.10）：掌柜删帖 → 帖下评论与落在其上的点赞一并清掉
    expect((await request.delete(`/api/collections/posts/records/${postId}`, { headers: HAdmin })).status()).toBe(204)
    const postsAfter = await (await request.get('/api/collections/posts/records?perPage=500')).json()
    expect(postsAfter.items.some((i: { sid: string }) => i.sid === postSid)).toBe(false)
    const commentsAfter = await (await request.get('/api/collections/post_comments/records?perPage=500')).json()
    expect(commentsAfter.items.some((i: { sid: string }) => i.sid === cSid)).toBe(false)
    const likesAfter = await (await request.get('/api/collections/content_likes/records?perPage=500')).json()
    expect(likesAfter.items.some((i: { sid: string }) => i.sid === `post:${postSid}:${eId}`)).toBe(false)

    // 活动删除级联：发起人删自己的活动 → 报名行随之清掉
    expect((await request.delete(`/api/collections/events/records/${evId}`, { headers: H })).status()).toBe(204)
    const attAfter = await (await request.get('/api/collections/event_attendees/records?perPage=500')).json()
    expect(attAfter.items.some((i: { event_sid: string }) => i.event_sid === evSid)).toBe(false)

    // 注销本人账号
    expect((await request.delete(`/api/collections/users/records/${eId}`, { headers: H })).status()).toBe(204)

    // 公开目录 / 名单不再残留本人数据
    const posts = await (await request.get('/api/collections/posts/records?perPage=500')).json()
    expect(posts.items.some((i: { sid: string }) => i.sid === postSid)).toBe(false)
    const profiles = await (await request.get('/api/collections/profiles/records?perPage=500')).json()
    expect(profiles.items.some((i: { sid: string }) => i.sid === eId)).toBe(false)
    const events = await (await request.get('/api/collections/events/records?perPage=500')).json()
    expect(events.items.some((i: { sid: string }) => i.sid === evSid)).toBe(false)
    const attendees = await (await request.get('/api/collections/event_attendees/records?perPage=500')).json()
    expect(attendees.items.some((i: { owner_sid: string }) => i.owner_sid === eId)).toBe(false)
    const likes = await (await request.get('/api/collections/content_likes/records?perPage=500')).json()
    expect(likes.items.some((i: { owner_sid: string }) => i.owner_sid === eId)).toBe(false)

    // 掌柜视角：私密收藏行已清；双方共有的会话消息保留（对方侧仍可查）
    const favs = await (await request.get('/api/collections/favorites/records?perPage=500', { headers: HAdmin })).json()
    expect(favs.items.some((i: { owner_sid: string }) => i.owner_sid === eId)).toBe(false)
    const chats = await (await request.get('/api/collections/chat_messages/records?perPage=500', { headers: HAdmin })).json()
    expect(chats.items.some((i: { sid: string }) => i.sid === chatSid)).toBe(true)

    // 已注销账号的旧令牌按匿名处理（私有表 403）
    expect((await request.get('/api/collections/favorites/records', { headers: H })).status()).toBe(403)
  })
})

test.describe('内容安全与审计留痕', () => {
  const ADMIN_EMAIL = 'admin@smoke.test'
  const ADMIN_PASS = 'Admin#2026x'

  test('敏感词拦截公开内容、私信不受限；掌柜词表即时生效；安全事件仅掌柜可查', async ({ request }) => {
    test.setTimeout(240_000)
    const stamp = Date.now()
    const mail = `word-${stamp}@smoke.test`
    const reg = await request.post('/api/collections/users/records', {
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '安全词员' },
    })
    expect(reg.status()).toBe(200)
    const login = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })).json()
    const H = { Authorization: login.token }
    const myId = login.record.id
    const adminLogin = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: ADMIN_EMAIL, password: ADMIN_PASS } })).json()
    const AH = { Authorization: adminLogin.token }

    // 内置底线词拦截公开发帖（字段级 400，提示含违规词）
    const blocked = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-word-${stamp}`, author_sid: myId, text: '低价出售枪支弹药', images: [], topic: '', featured: false, at: stamp },
    })
    expect(blocked.status()).toBe(400)
    const bBody = await blocked.json()
    expect(bBody.data.text.message).toContain('违规词')

    // 同字段正常内容不受影响
    const okPost = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-word-${stamp}`, author_sid: myId, text: '周末一起去爬山吧', images: [], topic: '', featured: false, at: stamp },
    })
    expect(okPost.status()).toBe(200)

    // 私密场景不拦：私信里出现底线词照常发送（正常交换信息不受影响）
    const dm = await request.post('/api/collections/chat_messages/records', {
      headers: H,
      data: { sid: `e2e-wdm-${stamp}`, sid_a: myId, sid_b: adminLogin.record.id, from_sid: myId, text: '最近高利贷电话骚扰我，拉黑了', at: stamp },
    })
    expect(dm.status()).toBe(200)

    // 掌柜豁免：处置违规内容时同词可写（改帖不 400）
    const adminEdit = await request.patch(`/api/collections/posts/records/${(await okPost.json()).id}`, {
      headers: AH,
      data: { text: '违规样本存档：枪支弹药（掌柜处置留档）' },
    })
    expect(adminEdit.status()).toBe(200)

    // 掌柜词表端点：读取含内置词；追加自定义词后会员发帖即时被拦
    const wfGet = await request.get('/api/admin/word-filter', { headers: AH })
    expect(wfGet.status()).toBe(200)
    const wfBody = await wfGet.json()
    expect(Array.isArray(wfBody.defaults)).toBe(true)
    expect(wfBody.defaults.length).toBeGreaterThan(0)
    const custom = `刷单${stamp}`
    const wfPut = await request.put('/api/admin/word-filter', { headers: AH, data: { words: [custom] } })
    expect(wfPut.status()).toBe(200)
    const blocked2 = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-word2-${stamp}`, author_sid: myId, text: `诚招${custom}日结`, images: [], topic: '', featured: false, at: stamp },
    })
    expect(blocked2.status()).toBe(400)
    expect((await blocked2.json()).data.text.message).toContain(custom)
    // 词表清空还原，避免影响其他用例
    expect((await request.put('/api/admin/word-filter', { headers: AH, data: { words: [] } })).status()).toBe(200)

    // 非掌柜访问词表与安全事件一律 403；匿名 403
    expect((await request.get('/api/admin/word-filter', { headers: H })).status()).toBe(403)
    expect((await request.get('/api/admin/security-events', { headers: H })).status()).toBe(403)
    expect((await request.get('/api/admin/security-events')).status()).toBe(403)

    // 掌柜可读安全事件：此前的违规词拦截与错误密码已留痕，身份已脱敏（不含完整邮箱）
    const evRes = await request.get('/api/admin/security-events?limit=100', { headers: AH })
    expect(evRes.status()).toBe(200)
    const evItems = (await evRes.json()).items as Array<{ type: string; identity: string | null; detail: Record<string, unknown> | null }>
    expect(evItems.some((e) => e.type === 'word_blocked')).toBe(true)
    expect(evItems.some((e) => e.type === 'login_success')).toBe(true)
    expect(evItems.every((e) => !(e.identity ?? '').includes(mail))).toBe(true)
    // 审计表不经通用集合接口暴露（掌柜也 404）
    expect((await request.get('/api/collections/security_events/records', { headers: AH })).status()).toBe(404)

    // 清理
    expect((await request.delete(`/api/collections/users/records/${myId}`, { headers: H })).status()).toBe(204)
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
