// 发布冒烟主链路：注册 → 登录 → 发帖 → 属主隔离 → 权限拦截 → 注销清理，
// 全部跑在隔离 schema 的测试网关上；另加一条 7300 E2E 页面服务的只读启动检查。
import { test, expect } from '@playwright/test'
import { ADMIN_EMAIL as SETUP_ADMIN_EMAIL, ADMIN_PASS as SETUP_ADMIN_PASS } from './global-setup.mjs'

const EMAIL = `e2e-${Date.now()}@smoke.test`
const PASS = 'Smoke#2026x'

const shanghaiDateKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

test.describe('数据网关主链路', () => {
  test('注册：短密码与不一致被字段级拦截', async ({ request }) => {
    const short = await request.post('/api/collections/users/records', {
      data: { email: EMAIL, password: '123', passwordConfirm: '123', adultConfirmed: true },
    })
    expect(short.status()).toBe(400)
    expect((await short.json()).data.password.message).toBeTruthy()

    const mismatch = await request.post('/api/collections/users/records', {
      data: { email: EMAIL, password: PASS, passwordConfirm: 'other#12345', adultConfirmed: true },
    })
    expect(mismatch.status()).toBe(400)
    expect((await mismatch.json()).data.passwordConfirm.message).toBeTruthy()
  })

  test('注册 → 登录 → 发帖 → 属主规则 → 清理', async ({ request }) => {
    // 注册
    const reg = await request.post('/api/collections/users/records', {
      data: { email: EMAIL, password: PASS, passwordConfirm: PASS, name: '冒烟员', adultConfirmed: true },
    })
    expect(reg.status()).toBe(200)
    const dup = await request.post('/api/collections/users/records', {
      data: { email: EMAIL, password: PASS, passwordConfirm: PASS, adultConfirmed: true },
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

    // 新帖必须使用试点内容方向，旧泛话题不能再从 API 绕过前端创建。
    const oldTopic = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: 'e2e-post-old-topic', author_sid: myId, text: '旧泛话题测试', images: [], topic: '慢生活', featured: false, at: Date.now() },
    })
    expect(oldTopic.status()).toBe(400)
    expect((await oldTopic.json()).data.topic.message).toBeTruthy()

    // 发帖（公开表）
    const post = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: 'e2e-post-1', author_sid: myId, text: '冒烟动态', images: [], likes: [], topic: '认识我', featured: false, at: Date.now() },
    })
    expect(post.status()).toBe(200)
    const postId = (await post.json()).id
    const listed = await request.get('/api/collections/posts/records?perPage=100', { headers: H })
    expect(listed.status()).toBe(200)
    expect((await listed.json()).items.some((i: { sid: string }) => i.sid === 'e2e-post-1')).toBe(true)

    // 改自己的动态
    const upd = await request.patch(`/api/collections/posts/records/${postId}`, {
      headers: H,
      data: { text: '冒烟动态-改' },
    })
    expect(upd.status()).toBe(200)
    expect((await upd.json()).text).toBe('冒烟动态-改')
    const oldTopicPatch = await request.patch(`/api/collections/posts/records/${postId}`, {
      headers: H,
      data: { topic: '慢生活' },
    })
    expect(oldTopicPatch.status()).toBe(400)

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


test.describe('真人发现与按需人物资料', () => {
  test('只按 ID 补人物；推荐满足双方条件，跳过后立即退出候选池', async ({ request }) => {
    test.setTimeout(180_000)
    const stamp = Date.now()
    const register = async (tag: string, name: string) => {
      const email = `discover-${tag}-${stamp}@smoke.test`
      const reg = await request.post('/api/collections/users/records', {
        data: { email, password: PASS, passwordConfirm: PASS, name, adultConfirmed: true },
      })
      expect(reg.status()).toBe(200)
      const loginRes = await request.post('/api/collections/users/auth-with-password', {
        data: { identity: email, password: PASS },
      })
      expect(loginRes.status()).toBe(200)
      const login = await loginRes.json()
      return { id: login.record.id as string, headers: { Authorization: login.token as string } }
    }

    const a = await register('a', '发现甲')
    const b = await register('b', '发现乙')
    const c = await register('c', '发现丙')

    const createProfile = async (
      user: { id: string; headers: { Authorization: string } },
      data: { nickname: string; gender: 'male' | 'female'; seeking: 'male' | 'female'; city: string },
    ) => {
      const res = await request.post('/api/collections/profiles/records', {
        headers: user.headers,
        data: {
          sid: user.id,
          nickname: data.nickname,
          gender: data.gender,
          seeking: data.seeking,
          birth_date: '1990-01-01',
          city: data.city,
          region: '',
          height: 0,
          job: '',
          bio: '',
          interests: ['阅读'],
          photos: [],
          verification: { phone: false, realname: false, photo: false },
          stealth: false,
          created_at: Date.now(),
          badge_dates: {},
        },
      })
      expect(res.status()).toBe(200)
    }

    const minorProfile = await request.post('/api/collections/profiles/records', {
      headers: c.headers,
      data: { sid: c.id, nickname: '未成年测试', gender: 'male', seeking: 'female', birth_date: '2012-01-01', city: '深圳' },
    })
    expect(minorProfile.status()).toBe(400)
    expect((await minorProfile.json()).data.birthDate.message).toContain('18')

    await createProfile(a, { nickname: '甲', gender: 'female', seeking: 'male', city: '深圳' })
    await createProfile(b, { nickname: '乙', gender: 'male', seeking: 'female', city: '深圳' })
    // 丙虽然是男性，但希望认识男性，不满足甲的双向必要条件。
    await createProfile(c, { nickname: '丙', gender: 'male', seeking: 'male', city: '深圳' })

    // 普通会员不能枚举整张 profiles；管理/运营全量读取仍由掌柜权限保留。
    expect((await request.get('/api/collections/profiles/records?perPage=100', { headers: a.headers })).status()).toBe(403)

    // lookup 不是公开目录：匿名不能取；登录成员只能按显式 opaque id 补页面所需资料。
    expect((await request.get(`/api/profiles/lookup?ids=${b.id}`)).status()).toBe(403)
    const lookup = await request.get(`/api/profiles/lookup?ids=${b.id},${c.id}`, { headers: a.headers })
    expect(lookup.status()).toBe(200)
    const lookupItems = (await lookup.json()).items as Array<{ sid: string }>
    expect(lookupItems.map(item => item.sid).sort()).toEqual([b.id, c.id].sort())
    expect(lookupItems.every(item => !('role' in item) && !('banned' in item))).toBe(true)

    // 服务端先做双向必要条件资格判断：乙可见，丙不可见。
    const discover1 = await request.get('/api/discovery/profiles?page=1&perPage=24', { headers: a.headers })
    expect(discover1.status()).toBe(200)
    const body1 = await discover1.json()
    const ids1 = (body1.items as Array<{ sid: string }>).map(item => item.sid)
    expect(ids1).toContain(b.id)
    expect(ids1).not.toContain(c.id)

    // 同一候选同一天重复下发只记一次；遥测明细不经通用 collection 暴露。
    const discoverAgain = await request.get('/api/discovery/profiles?page=1&perPage=24', { headers: a.headers })
    expect(discoverAgain.status()).toBe(200)
    expect(((await discoverAgain.json()).items as Array<{ sid: string }>).some(item => item.sid === b.id)).toBe(true)
    expect((await request.get('/api/collections/discovery_exposures/records', { headers: a.headers })).status()).toBe(404)
    expect((await request.get('/api/admin/pilot-metrics?days=7', { headers: a.headers })).status()).toBe(403)

    // 甲明确“且过”乙后，服务端候选池立即排除乙；不是只靠前端隐藏。
    const pass = await request.post('/api/collections/user_passes/records', {
      headers: a.headers,
      data: { sid: `${a.id}:${b.id}`, owner_sid: a.id, target_sid: b.id },
    })
    expect(pass.status()).toBe(200)
    const discover2 = await request.get('/api/discovery/profiles?page=1&perPage=24', { headers: a.headers })
    expect(discover2.status()).toBe(200)
    const ids2 = ((await discover2.json()).items as Array<{ sid: string }>).map(item => item.sid)
    expect(ids2).not.toContain(b.id)

    const adminLogin = await (await request.post('/api/collections/users/auth-with-password', {
      data: { identity: SETUP_ADMIN_EMAIL, password: SETUP_ADMIN_PASS },
    })).json()
    const HAdmin = { Authorization: adminLogin.token as string }
    const pilot = await request.get('/api/admin/pilot-metrics?days=7', { headers: HAdmin })
    expect(pilot.status()).toBe(200)
    const pilotBody = await pilot.json()
    expect(pilotBody.available).toBe(true)
    expect(pilotBody.supply.eligibleProfiles).toBe(3)
    expect(pilotBody.exposure).toMatchObject({ deliveries: 1, viewers: 1, targets: 1 })
    expect(pilotBody.exposure.coverageRate).toBeCloseTo(33.3, 1)
    expect(JSON.stringify(pilotBody)).not.toContain('viewer_sid')
    expect(JSON.stringify(pilotBody)).not.toContain('target_sid')

    // 清理隔离测试账号；注销必须同步清除其推荐曝光行为数据。
    expect((await request.delete(`/api/collections/users/records/${a.id}`, { headers: a.headers })).status()).toBe(204)
    const pilotAfterDelete = await request.get('/api/admin/pilot-metrics?days=7', { headers: HAdmin })
    expect(pilotAfterDelete.status()).toBe(200)
    expect((await pilotAfterDelete.json()).exposure.deliveries).toBe(0)
    expect((await request.delete(`/api/collections/users/records/${b.id}`, { headers: b.headers })).status()).toBe(204)
    expect((await request.delete(`/api/collections/users/records/${c.id}`, { headers: c.headers })).status()).toBe(204)
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
      data: { email: mailA, password: PASS, passwordConfirm: PASS, name: '计数甲', adultConfirmed: true },
    })
    const regB = await request.post('/api/collections/users/records', {
      data: { email: mailB, password: PASS, passwordConfirm: PASS, name: '计数乙', adultConfirmed: true },
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
      data: { sid: postSid, author_sid: aId, text: '甲的动态', images: [], topic: '认识我', featured: false, at: stamp },
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

    // 点赞走独立表：乙给自己的点赞行建档 OK，冒充甲被拒；真人计数需登录读取，甲不能删乙的行
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
    expect(anonLikes.status()).toBe(403)
    const memberLikes = await request.get('/api/collections/content_likes/records', { headers: HA })
    expect(memberLikes.status()).toBe(200)
    expect(((await memberLikes.json()).items as Array<{ sid: string }>).some(item => item.sid === likeSid)).toBe(false)
    const ownerLikes = await request.get('/api/collections/content_likes/records', { headers: HB })
    expect(ownerLikes.status()).toBe(200)
    expect(((await ownerLikes.json()).items as Array<{ sid: string }>).some(item => item.sid === likeSid)).toBe(true)
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
        data: { email: mail, password: PASS, passwordConfirm: PASS, name, adultConfirmed: true },
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
      data: { sid: evSid, title: '满员测试场', city: '杭州', region: '', cover: '', date: shanghaiDateKey(), time: '', capacity: 2, desc: '', tags: [], host: '丙', creator_sid: host.id, requirements: '', pinned: false, images: [] },
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

    // events domain：列表使用轻量数据；详情按角色控制真实名单与联系方式。
    const eventList = await request.get(`/api/events/list?ids=${encodeURIComponent(evSid)}&localFirst=0`, { headers: third.H })
    expect(eventList.status()).toBe(200)
    const eventItems = (await eventList.json()).items as Array<{ id: string; attendees: string[] }>
    expect(eventItems.some(item => item.id === evSid)).toBe(true)
    const hostDetail = await request.get(`/api/events/${encodeURIComponent(evSid)}/detail`, { headers: host.H })
    expect(hostDetail.status()).toBe(200)
    const hostDetailBody = await hostDetail.json()
    expect(hostDetailBody.event.attendees).toContain(third.id)
    expect(hostDetailBody.contacts[third.id]).toBe('wechat-123')
    const guestDetail = await request.get(`/api/events/${encodeURIComponent(evSid)}/detail`, { headers: guest.H })
    expect(guestDetail.status()).toBe(200)
    expect((await guestDetail.json()).contacts).toEqual({})

    // 签到：通用集合直写关闭；主办方现场取码，报名成员凭码核销且重复提交幂等。
    const directCheckin = await request.post('/api/collections/checkins/records', {
      headers: third.H,
      data: { sid: `${third.id}:${evSid}`, owner_sid: third.id, event_sid: evSid },
    })
    expect(directCheckin.status()).toBe(403)
    expect((await request.get(`/api/events/${encodeURIComponent(evSid)}/checkin-code`, { headers: guest.H })).status()).toBe(403)
    const codeRes = await request.get(`/api/events/${encodeURIComponent(evSid)}/checkin-code`, { headers: host.H })
    expect(codeRes.status()).toBe(200)
    const code = (await codeRes.json()).code as string
    expect(code).toMatch(/^\d{6}$/)
    const wrongCode = await request.post(`/api/events/${encodeURIComponent(evSid)}/checkin`, { headers: third.H, data: { code: '000000' } })
    expect(wrongCode.status()).toBe(400)
    const ci = await request.post(`/api/events/${encodeURIComponent(evSid)}/checkin`, { headers: third.H, data: { code } })
    expect(ci.status()).toBe(200)
    expect((await ci.json()).checkedIn).toBe(true)
    const ciAgain = await request.post(`/api/events/${encodeURIComponent(evSid)}/checkin`, { headers: third.H, data: { code } })
    expect(ciAgain.status()).toBe(200)
    const guestCheckins = await request.get('/api/collections/checkins/records', { headers: guest.H })
    expect((await guestCheckins.json()).items.some((i: { owner_sid: string }) => i.owner_sid === third.id)).toBe(false)
    const hostCheckins = await request.get('/api/collections/checkins/records', { headers: host.H })
    expect((await hostCheckins.json()).items.some((i: { owner_sid: string }) => i.owner_sid === third.id)).toBe(true)
    const activityStats = await request.get('/api/me/activity-stats', { headers: third.H })
    expect(activityStats.status()).toBe(200)
    expect((await activityStats.json()).joinedEvents).toBeGreaterThanOrEqual(1)

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
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '护栏员', adultConfirmed: true },
    })
    expect(reg.status()).toBe(200)
    const login = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })).json()
    const H = { Authorization: login.token }
    const myId = login.record.id

    // 超长正文（上限 5000 字）→ 字段级 400
    const long = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-lim-${stamp}`, author_sid: myId, text: '缘'.repeat(5001), images: [], topic: '认识我', featured: false, at: stamp },
    })
    expect(long.status()).toBe(400)
    expect((await long.json()).data.text.message).toBeTruthy()

    // 超量配图（上限 9 张）→ 字段级 400
    const manyImgs = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-lim2-${stamp}`, author_sid: myId, text: '正常文字', images: Array.from({ length: 10 }, (_, i) => `data:,${i}`), topic: '认识我', featured: false, at: stamp },
    })
    expect(manyImgs.status()).toBe(400)
    expect((await manyImgs.json()).data.images.message).toBeTruthy()

    // 正常尺寸不受影响
    const ok = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-lim3-${stamp}`, author_sid: myId, text: '正常长度的分享', images: ['data:,0'], topic: '认识我', featured: false, at: stamp },
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
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '防爆破员', adultConfirmed: true },
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
    const reg2 = await request.post('/api/collections/users/records', { data: { email: mail2, password: PASS, passwordConfirm: PASS, name: '防爆破乙', adultConfirmed: true } })
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
      data: { email: mailA, password: PASS, passwordConfirm: PASS, name: '后端甲', adultConfirmed: true },
    })
    const regB = await request.post('/api/collections/users/records', {
      data: { email: mailB, password: PASS, passwordConfirm: PASS, name: '后端乙', adultConfirmed: true },
    })
    expect(regA.status()).toBe(200)
    expect(regB.status()).toBe(200)
    const loginA = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mailA, password: PASS } })).json()
    const loginB = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mailB, password: PASS } })).json()
    const HA = { Authorization: loginA.token }
    const HB = { Authorization: loginB.token }
    const aId = loginA.record.id
    const bId = loginB.record.id

    // 两边都建真实资料行；反馈聚合只统计存在的真实 profile。
    expect((await request.post('/api/collections/profiles/records', { headers: HA, data: { sid: aId, nickname: '甲' } })).status()).toBe(200)

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
      data: { sid: `forge-p-${stamp}`, author_sid: aId, text: '冒充甲的动态', images: [], topic: '认识我', featured: false, at: stamp },
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

    // 解除拉黑后仍不能直接私信：必须先有双方真实「有意」
    expect((await request.delete(`/api/collections/blocks/records/${blkId}`, { headers: HA })).status()).toBe(204)
    const likeBA = await request.post('/api/collections/user_likes/records', {
      headers: HB,
      data: { sid: `${bId}:${aId}`, owner_sid: bId, target_sid: aId },
    })
    expect(likeBA.status()).toBe(200)
    const beforeMutual = await request.post('/api/collections/chat_messages/records', {
      headers: HB,
      data: { sid: `m2-pre-${stamp}`, sid_a: bId, sid_b: aId, from_sid: bId, text: '只有单边有意', images: [], recalled: false, read_at: 0, at: stamp },
    })
    expect(beforeMutual.status()).toBe(403)
    const likeAB = await request.post('/api/collections/user_likes/records', {
      headers: HA,
      data: { sid: `${aId}:${bId}`, owner_sid: aId, target_sid: bId },
    })
    expect(likeAB.status()).toBe(200)
    const feedbackBeforeChat = await request.get(`/api/me/relationship-feedback/${bId}`, { headers: HA })
    expect(feedbackBeforeChat.status()).toBe(200)
    expect(await feedbackBeforeChat.json()).toMatchObject({ available: true, eligible: false, outcome: null })
    expect((await request.put(`/api/me/relationship-feedback/${bId}`, { headers: HA, data: { outcome: 'continue' } })).status()).toBe(400)
    const chat2 = await request.post('/api/collections/chat_messages/records', {
      headers: HB,
      data: { sid: `m2-${stamp}`, sid_a: bId, sid_b: aId, from_sid: bId, text: '你好呀', images: [], recalled: false, read_at: 0, at: stamp },
    })
    expect(chat2.status()).toBe(200)
    // 登录首包只需会话摘要；打开具体对象后再按需读取该会话完整消息。
    const summariesA = await request.get('/api/chats/summaries', { headers: HA })
    expect(summariesA.status()).toBe(200)
    const summaryItems = (await summariesA.json()).items as Array<{ otherId: string; lastText: string; unread: number }>
    const summaryB = summaryItems.find(item => item.otherId === bId)
    expect(summaryB?.lastText).toBe('你好呀')
    expect(summaryB?.unread).toBe(1)
    expect((await request.get(`/api/chats/${bId}/messages`)).status()).toBe(403)
    const conversationA = await request.get(`/api/chats/${bId}/messages`, { headers: HA })
    expect(conversationA.status()).toBe(200)
    const conversationItems = (await conversationA.json()).items as Array<{ id: string; text: string; from: string }>
    expect(conversationItems.some(item => item.id === `m2-${stamp}` && item.text === '你好呀' && item.from === bId)).toBe(true)

    // 关系反馈只保存本人当前选择：对方看不到；原始表也不开放 collection 枚举。
    const feedbackSet = await request.put(`/api/me/relationship-feedback/${bId}`, { headers: HA, data: { outcome: 'continue' } })
    expect(feedbackSet.status()).toBe(200)
    expect(await feedbackSet.json()).toMatchObject({ available: true, eligible: true, outcome: 'continue' })
    expect(await (await request.get(`/api/me/relationship-feedback/${bId}`, { headers: HA })).json()).toMatchObject({ eligible: true, outcome: 'continue' })
    expect(await (await request.get(`/api/me/relationship-feedback/${aId}`, { headers: HB })).json()).toMatchObject({ eligible: true, outcome: null })
    expect((await request.get('/api/collections/relationship_feedback/records', { headers: HA })).status()).toBe(404)

    // 普通会员登录首包不再携带历史明细；周报消息活动走轻量自助端点，不下发正文。
    const chatActivity = await request.get(`/api/me/chat-activity?since=${stamp - 1}`, { headers: HA })
    expect(chatActivity.status()).toBe(200)
    const chatActivityItems = (await chatActivity.json()).items as Array<{ otherId: string; at: number; direction: string; text?: string }>
    expect(chatActivityItems.some(item => item.otherId === bId && item.direction === 'received')).toBe(true)
    expect(chatActivityItems.every(item => !('text' in item))).toBe(true)

    // 乙访问甲；甲只通过本人 visits 自助端点按需读取，不依赖通用集合登录水合。
    expect((await request.post('/api/collections/visits/records', {
      headers: HB,
      data: { sid: `${bId}:${aId}`, viewer_sid: bId, viewed_sid: aId, at: stamp + 1 },
    })).status()).toBe(200)
    const myVisits = await request.get(`/api/me/visits?since=${stamp}&limit=50`, { headers: HA })
    expect(myVisits.status()).toBe(200)
    const myVisitItems = (await myVisits.json()).items as Array<{ viewerId: string; viewedId: string; at: number }>
    expect(myVisitItems.some(item => item.viewerId === bId && item.viewedId === aId)).toBe(true)

    // 停用：掌柜标记后登录被拒、旧令牌全拒；恢复后照常
    const adminLogin = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: ADMIN_EMAIL, password: ADMIN_PASS } })).json()
    const HAdmin = { Authorization: adminLogin.token }
    const pilotWithFeedback = await request.get('/api/admin/pilot-metrics?days=7', { headers: HAdmin })
    expect(pilotWithFeedback.status()).toBe(200)
    expect((await pilotWithFeedback.json()).funnel).toMatchObject({ feedbackContinue: 1, feedbackPause: 0 })

    // 举报工单：成员只能读自己的；通用 PATCH 仍禁止成员；掌柜经 safety 专用端点处置，举报人可申诉一次。
    const rpSid = `rp-${stamp}`
    expect((await request.post('/api/collections/reports/records', { headers: HA, data: { sid: rpSid, by_sid: aId, target_sid: bId, reason: '骚扰', note: '', status: 'open', at: stamp } })).status()).toBe(200)
    const myReportsBefore = await request.get('/api/me/reports', { headers: HA })
    expect(myReportsBefore.status()).toBe(200)
    expect(((await myReportsBefore.json()).items as Array<{ sid: string }>).some(item => item.sid === rpSid)).toBe(true)
    const bReports = await request.get('/api/me/reports', { headers: HB })
    expect(((await bReports.json()).items as Array<{ sid: string }>).some(item => item.sid === rpSid)).toBe(false)
    const rpList = await (await request.get('/api/collections/reports/records', { headers: HA })).json()
    const rpId = rpList.items.find((i: { sid: string }) => i.sid === rpSid).id
    const rpPatchByMember = await request.patch(`/api/collections/reports/records/${rpId}`, { headers: HB, data: { status: 'done' } })
    expect(rpPatchByMember.status()).toBe(403)
    const resolved = await request.post(`/api/admin/reports/${encodeURIComponent(rpSid)}/resolve`, { headers: HAdmin, data: { action: 'dismiss' } })
    expect(resolved.status()).toBe(200)
    expect((await resolved.json()).resolution).toBe('dismiss')
    const appeal = await request.post(`/api/reports/${encodeURIComponent(rpSid)}/appeal`, { headers: HA, data: { note: '补充事实，请重新复核' } })
    expect(appeal.status()).toBe(200)
    expect((await appeal.json()).appeal_status).toBe('open')

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

    // 清理：甲注销后其关系反馈必须同步清除，掌柜聚合回到 0。
    expect((await request.delete(`/api/collections/users/records/${aId}`, { headers: HA })).status()).toBe(204)
    const pilotAfterFeedbackDelete = await request.get('/api/admin/pilot-metrics?days=7', { headers: HAdmin })
    expect(pilotAfterFeedbackDelete.status()).toBe(200)
    expect((await pilotAfterFeedbackDelete.json()).funnel.feedbackContinue).toBe(0)
    expect((await request.delete(`/api/collections/users/records/${bId}`, { headers: { Authorization: (await loginOk.json()).token } })).status()).toBe(204)
  })

  test('掌柜重置密码、邮箱大小写唯一、深度健康检查', async ({ request }) => {
    test.setTimeout(240_000)
    const stamp = Date.now()
    const mailC = `be-c-${stamp}@smoke.test`
    const regC = await request.post('/api/collections/users/records', {
      data: { email: mailC, password: PASS, passwordConfirm: PASS, name: '后端丙', adultConfirmed: true },
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
    const regM1 = await request.post('/api/collections/users/records', { data: { email: mailM, password: PASS, passwordConfirm: PASS, name: '大小写', adultConfirmed: true } })
    expect(regM1.status()).toBe(200)
    const regM2 = await request.post('/api/collections/users/records', { data: { email: mailM.toLowerCase(), password: PASS, passwordConfirm: PASS, name: '大小写', adultConfirmed: true } })
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
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '周期员', adultConfirmed: true },
    })
    expect(reg.status()).toBe(200)
    const login1 = await (await request.post('/api/collections/users/auth-with-password', { data: { identity: mail, password: PASS } })).json()
    const H1 = { Authorization: login1.token }
    const myId = login1.record.id

    // 上传：匿名被拒；登录成员拿到不可猜测 URL；GET 可读；非图片类型被拒
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const anonUp = await request.post('/api/uploads', { data: { image: png } })
    expect(anonUp.status()).toBe(403)
    const up = await request.post('/api/uploads', { headers: H1, data: { purpose: 'profile', image: png } })
    expect(up.status()).toBe(200)
    const upBody = await up.json()
    expect(upBody.url).toMatch(/^\/api\/uploads\/v2-profile-[a-z0-9]+-[a-f0-9]{24}\.png\?sig=[A-Za-z0-9_-]+$/)
    const unsignedPath = String(upBody.url).split('?')[0]
    // capability 缺失时用 404 隐藏资源是否存在。
    expect((await request.get(unsignedPath)).status()).toBe(404)
    // 即使磁盘中真实存在 legacy 随机文件，unsigned 旧路径也必须保持 404。
    expect((await request.get('/api/uploads/e2elegacy-0123456789abcdef01234567.png')).status()).toBe(404)
    const fetched = await request.get(upBody.url)
    expect(fetched.status()).toBe(200)
    expect(fetched.headers()['content-type']).toBe('image/png')
    const badType = await request.post('/api/uploads', { headers: H1, data: { purpose: 'profile', image: 'data:text/html;base64,PGI+eDwvYj4=' } })
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
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '注销员', adultConfirmed: true },
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
    const postRes = await request.post('/api/collections/posts/records', { headers: H, data: { sid: postSid, author_sid: eId, text: '告别前的分享', images: [], topic: '认识我', featured: false, at: stamp } })
    expect(postRes.status()).toBe(200)
    const postId = (await postRes.json()).id
    expect((await request.post('/api/collections/post_comments/records', { headers: H, data: { sid: cSid, post_sid: postSid, author_sid: eId, text: '自己占一楼', at: stamp } })).status()).toBe(200)
    const evRes = await request.post('/api/collections/events/records', { headers: H, data: { sid: evSid, title: '告别活动', city: '杭州', region: '', cover: '', date: '2026-10-01', time: '19:00', capacity: 5, desc: '', tags: [], host: '注销员', creator_sid: eId, requirements: '', pinned: false, images: [] } })
    expect(evRes.status()).toBe(200)
    const evId = (await evRes.json()).id
    expect((await request.post('/api/collections/event_attendees/records', { headers: H, data: { sid: `${evSid}:${eId}`, event_sid: evSid, owner_sid: eId } })).status()).toBe(200)
    expect((await request.post('/api/collections/content_likes/records', { headers: H, data: { sid: `post:${postSid}:${eId}`, kind: 'post', target_sid: postSid, owner_sid: eId } })).status()).toBe(200)
    expect((await request.post('/api/collections/favorites/records', { headers: H, data: { sid: `${eId}:posts:${postSid}`, owner_sid: eId, fav_type: 'posts', target_sid: postSid, group_name: '' } })).status()).toBe(200)
    // 会话是双方共有记录，但只有双方真实「有意」后才能建立。
    expect((await request.post('/api/collections/user_likes/records', { headers: H, data: { sid: `${eId}:${ADMIN_ID}`, owner_sid: eId, target_sid: ADMIN_ID } })).status()).toBe(200)
    expect((await request.post('/api/collections/user_likes/records', { headers: HAdmin, data: { sid: `${ADMIN_ID}:${eId}`, owner_sid: ADMIN_ID, target_sid: eId } })).status()).toBe(200)
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
    const postsAfter = await (await request.get('/api/collections/posts/records?perPage=500', { headers: HAdmin })).json()
    expect(postsAfter.items.some((i: { sid: string }) => i.sid === postSid)).toBe(false)
    const commentsAfter = await (await request.get('/api/collections/post_comments/records?perPage=500', { headers: HAdmin })).json()
    expect(commentsAfter.items.some((i: { sid: string }) => i.sid === cSid)).toBe(false)
    const likesAfter = await (await request.get('/api/collections/content_likes/records?perPage=500', { headers: HAdmin })).json()
    expect(likesAfter.items.some((i: { sid: string }) => i.sid === `post:${postSid}:${eId}`)).toBe(false)

    // 活动删除级联：发起人删自己的活动 → 报名行随之清掉
    expect((await request.delete(`/api/collections/events/records/${evId}`, { headers: H })).status()).toBe(204)
    const attAfter = await (await request.get('/api/collections/event_attendees/records?perPage=500', { headers: HAdmin })).json()
    expect(attAfter.items.some((i: { event_sid: string }) => i.event_sid === evSid)).toBe(false)

    // 注销本人账号
    expect((await request.delete(`/api/collections/users/records/${eId}`, { headers: H })).status()).toBe(204)

    // 公开目录 / 名单不再残留本人数据
    const posts = await (await request.get('/api/collections/posts/records?perPage=500', { headers: HAdmin })).json()
    expect(posts.items.some((i: { sid: string }) => i.sid === postSid)).toBe(false)
    const profiles = await (await request.get('/api/collections/profiles/records?perPage=500', { headers: HAdmin })).json()
    expect(profiles.items.some((i: { sid: string }) => i.sid === eId)).toBe(false)
    const events = await (await request.get('/api/collections/events/records?perPage=500', { headers: HAdmin })).json()
    expect(events.items.some((i: { sid: string }) => i.sid === evSid)).toBe(false)
    const attendees = await (await request.get('/api/collections/event_attendees/records?perPage=500', { headers: HAdmin })).json()
    expect(attendees.items.some((i: { owner_sid: string }) => i.owner_sid === eId)).toBe(false)
    const likes = await (await request.get('/api/collections/content_likes/records?perPage=500', { headers: HAdmin })).json()
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
      data: { email: mail, password: PASS, passwordConfirm: PASS, name: '安全词员', adultConfirmed: true },
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
      data: { sid: `e2e-word-${stamp}`, author_sid: myId, text: '低价出售枪支弹药', images: [], topic: '认识我', featured: false, at: stamp },
    })
    expect(blocked.status()).toBe(400)
    const bBody = await blocked.json()
    expect(bBody.data.text.message).toContain('违规词')

    // 同字段正常内容不受影响
    const okPost = await request.post('/api/collections/posts/records', {
      headers: H,
      data: { sid: `e2e-word-${stamp}`, author_sid: myId, text: '周末一起去爬山吧', images: [], topic: '认识我', featured: false, at: stamp },
    })
    expect(okPost.status()).toBe(200)

    // 先建立真实 mutual；私密内容过滤测试不能绕过会话资格。
    expect((await request.post('/api/collections/user_likes/records', { headers: H, data: { sid: `${myId}:${adminLogin.record.id}`, owner_sid: myId, target_sid: adminLogin.record.id } })).status()).toBe(200)
    expect((await request.post('/api/collections/user_likes/records', { headers: AH, data: { sid: `${adminLogin.record.id}:${myId}`, owner_sid: adminLogin.record.id, target_sid: myId } })).status()).toBe(200)

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
      data: { sid: `e2e-word2-${stamp}`, author_sid: myId, text: `诚招${custom}日结`, images: [], topic: '认识我', featured: false, at: stamp },
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
  test('正式同源首页可渲染且无崩溃', async ({ page }) => {
    await page.goto('http://127.0.0.1:7200/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).not.toHaveText('')
    await expect(page.getByText('页面渲染出错', { exact: false })).toHaveCount(0)
  })

  test('正式构建同源交付：深链刷新、静态资产、PocketBase 代理、就绪探针和敏感路径', async ({ page, request }) => {
    const origin = 'http://127.0.0.1:7200'
    const deep = await request.get(origin + '/matches/')
    expect(deep.status()).toBe(200)
    expect(deep.headers()['content-type']).toContain('text/html')
    expect(deep.headers()['cache-control']).toContain('no-store')
    const html = await deep.text()
    expect(html).toContain('<base href="/">')
    const asset = html.match(/<script[^>]+src="([^"]+)"/i)?.[1]
    expect(asset).toBeTruthy()
    // Relative assets resolve against the document's explicit <base href="/">, not the deep route.
    const assetRes = await request.get(new URL(asset!, origin + '/').toString())
    expect(assetRes.status()).toBe(200)
    expect(assetRes.headers()['content-type']).toContain('javascript')
    expect(assetRes.headers()['cache-control']).toContain('immutable')

    expect((await request.get(origin + '/api/ready')).status()).toBe(200)
    expect((await request.get(origin + '/__pb/api/health?deep=1')).status()).toBe(200)
    for (const unsafe of ['/src/App.tsx', '/.env', '/assets/missing.js']) {
      expect((await request.get(origin + unsafe)).status()).toBe(404)
    }
    const response = await page.goto(origin + '/matches/', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/auth/)
    await expect(page.getByText('页面渲染出错', { exact: false })).toHaveCount(0)
  })

  test('正式构建真实浏览器：注册表单 → 我的主页 → 刷新保持登录', async ({ page }) => {
    test.setTimeout(100_000)
    const origin = 'http://127.0.0.1:7200'
    const email = `browser-${Date.now()}@smoke.test`
    await page.goto(origin + '/auth?mode=register', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '加入随缘网' })).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('邮箱', { exact: true }).fill(email)
    await page.getByLabel('昵称（可稍后修改）').fill('浏览器冒烟会员')
    await page.getByLabel('密码', { exact: true }).fill(PASS)
    await page.getByLabel('确认密码').fill(PASS)
    await page.getByRole('checkbox', { name: /我确认已满 18 周岁/ }).check()
    await page.getByRole('button', { name: '注册并继续完善资料' }).click()
    await expect(page).toHaveURL(/\/me$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: '打理自己的缘' })).toBeVisible({ timeout: 30_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '打理自己的缘' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('页面渲染出错', { exact: false })).toHaveCount(0)
  })
})
