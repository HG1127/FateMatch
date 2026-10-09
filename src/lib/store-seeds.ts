import { scene } from './art'
import { weekNo } from './store-model'
import type { EventItem, Gender, Post, PostComment, User, WeeklyDigest } from './store-types'

/** 游客演示世界：只用于未登录预览，绝不写入真人业务库。 */
const FACE: Record<string, string> = {
  u01: 'p01', u02: 'm02', u03: 'p02', u04: 'm04', u05: 'w05', u06: 'p03',
  u07: 'w07', u08: 'm08', u09: 'p05', u10: 'm10', u11: 'p06', u12: 'p04', adm: 'm00',
}
const faceOf = (id: string) => `${import.meta.env.BASE_URL}assets/faces/${FACE[id]}.jpg`
const pic = (seed: string, size = '600/400') => `https://picsum.photos/seed/${seed}/${size}`
const SCENE_KEYS = ['lake', 'mountains', 'lantern', 'pagoda', 'branch', 'board', 'museum'] as const
const lifeShots = (n: number) => [
  scene(SCENE_KEYS[n % SCENE_KEYS.length], '#6d3a2a', '#d9a05b'),
  scene(SCENE_KEYS[(n + 3) % SCENE_KEYS.length], '#274435', '#9dc0a8'),
]

export function seedUsers(): User[] {
  const base = { password: 'demo123456', createdAt: Date.now() }
  const mk = (
    id: string, nickname: string, gender: Gender, birthDate: string, city: string,
    height: number, job: string, bio: string, interests: string[],
    avatar: number,
  ): User => ({
    ...base, id, phone: `1380000${id.slice(1).padStart(4, '0')}`,
    nickname, gender, seeking: gender === 'female' ? 'male' : 'female',
    birthDate, city, height, job, bio, interests,
    photos: [faceOf(id), ...lifeShots(avatar)],
    verification: { phone: true, realname: true, photo: true },
    createdAt: Date.now(),
  })
  return [
    mk('u01', '沈知微', 'female', '1996-03-12', '杭州', 165, '语文教师', '喜欢把日子过成诗,闲时抄诗、煮茶,也想遇见一个愿意听我念诗的人。', ['诗词', '茶艺', '汉服', '书法'], 5),
    mk('u02', '周慕云', 'male', '1992-08-02', '上海', 181, '建筑师', '画了十年图纸,仍相信生活里最美的结构是两个人的默契。', ['摄影', '电影', '旅行', '音乐'], 12),
    mk('u03', '苏晚晴', 'female', '1998-11-23', '苏州', 162, '平面设计师', '园林里长大的姑娘,爱逛展也爱下厨,想把江南的甜做给你吃。', ['看展', '烹饪', '汉服', '美食'], 9),
    mk('u04', '谢景行', 'male', '1990-05-17', '杭州', 178, '中医医师', '望闻问切是日常,也想认真读懂一个人。周末爬山采药,生活规律。', ['登山', '茶艺', '围棋', '国风'], 3),
    mk('u05', '林之夏', 'female', '1999-06-30', '成都', 168, '咖啡师', '拉花会画千百年后的山水,也会画你的笑脸。喜欢骑行和livehouse。', ['音乐', '骑行', '美食', '电影'], 25),
    mk('u06', '白敬亭', 'male', '1994-01-09', '北京', 183, '产品经理', '理性工作,感性生活。攒了一年的假期,想找个一起去敦煌的人。', ['旅行', '摄影', '桌游', '美食'], 8),
    mk('u07', '顾南枝', 'female', '1995-09-14', '南京', 166, '编辑', '书里见过很多爱情,仍想亲自遇见一次。写字、看展、慢热但认真。', ['书法', '看展', '诗词', '音乐'], 44),
    mk('u08', '程屿', 'male', '1991-12-01', '广州', 176, '厨师', '能把一碗云吞面做到极致,也能把日子过得有滋有味。', ['烹饪', '美食', '电影', '骑行'], 13),
    mk('u09', '陆清瑶', 'female', '1997-04-21', '西安', 170, '博物馆讲解员', '讲了一千遍长安城的故事,也想有人讲给我听外面的世界。', ['国风', '汉服', '旅行', '看展'], 47),
    mk('u10', '孟繁星', 'male', '1993-07-27', '成都', 180, '天文科研', '看星星的人,也想看看爱情。慢热、话少,但会把浪漫做到实处。', ['摄影', '登山', '音乐', '围棋'], 53),
    mk('u11', '姜婉', 'female', '2000-02-08', '上海', 163, '插画师', '画了很多别人的故事,这次想画自己的。喜欢桌游和猫。', ['桌游', '看展', '美食', '摄影'], 49),
    mk('u12', '沈砚', 'male', '1989-10-19', '苏州', 177, '古琴修复师', '修琴十年,懂得慢的价值。愿得一人心,白首不相离。', ['国风', '汉服', '音乐', '茶艺'], 59),
    {
      id: 'adm', phone: '18279827381', password: '123456',
      nickname: '随缘掌柜', gender: 'male', seeking: 'female',
      birthDate: '1990-01-01', city: '杭州', height: 175, job: '平台运营',
      bio: '随缘网系统管理员,负责平台配置与内容维护。',
      interests: ['国风'], photos: [faceOf('adm')],
      verification: { phone: true, realname: true, photo: true },
      createdAt: Date.now(), role: 'admin',
    },
  ]
}

const H = 3600_000

export function seedPosts(): Post[] {
  const now = Date.now()
  const p = (id: string, authorId: string, text: string, topic: string, images: string[], likes: string[], comments: PostComment[], hoursAgo: number, featured = false): Post =>
    ({ id, authorId, text, topic, images, likes, comments, at: now - hoursAgo * H, featured })
  return [
    p('p01', 'u01', '今日煮了一壶桂花乌龙,抄了半页《浮生六记》。窗外的桂香漫进来,忽然觉得,这样的日子该有一个人共坐。', '慢生活', [pic('sy-post-guihua')], ['u02', 'u04', 'u07', 'u12'], [{ id: 'c01', authorId: 'u12', text: '「布衣菜饭,可乐终身。」沈三白与芸娘的日子,最是动人。', at: now - 5 * H }], 7),
    p('p02', 'u04', '周末去天目山采药,云雾从脚下漫上来,像走进一幅未干的水墨。山顶遇见一位同样独自爬山的老哥,聊了一路黄芪与当归。缘分这事,山里也有。', '山与海', [pic('sy-post-mountain')], ['u01', 'u10', 'u03'], [{ id: 'c02', authorId: 'u10', text: '下次登山活动带上我,我也想看看云从脚下漫上来。', at: now - 20 * H }], 26),
    p('p03', 'u05', '拉花新练习:把「缘」字拉进拿铁里。失败的第七杯被我自己喝掉了,成功的那杯,想留给某个还没出现的人。', '慢生活', [pic('sy-post-latte')], ['u01', 'u03', 'u11', 'u06', 'u08'], [{ id: 'c03', authorId: 'u08', text: '作为厨师,我赌第九杯就能成。', at: now - 30 * H }, { id: 'c04', authorId: 'u05', text: '借你吉言,成了请你喝。', at: now - 29 * H }], 32),
    p('p04', 'u10', '昨晚在冷湖观测点拍到银河,零下三度,手抖得按不稳快门。但看到成片那一刻觉得,这片星空值得分享给一个具体的人,而不是朋友圈。', '山与海', [pic('sy-post-galaxy')], ['u02', 'u05', 'u09'], [], 50),
    p('p05', 'u09', '给游客讲了一千遍长乐公主的故事,今天有位客人问我:「那她幸福吗?」我愣住。史书不写幸福,只写年份。可我多想回答:愿她所遇皆良人。', '诗与远方', [], ['u01', 'u07', 'u11', 'u12'], [{ id: 'c05', authorId: 'u07', text: '这一问一答,本身就是一个好故事。', at: now - 60 * H }], 70),
    p('p06', 'u08', '研究了一道新菜:桂花糖藕配陈皮红豆沙。甜是甜的两个层次,像两个人相处,各有各的回甘。招募试吃员一名,长期。', '食记', [pic('sy-post-sweet')], ['u03', 'u05', 'u06'], [{ id: 'c06', authorId: 'u03', text: '「长期」两个字,写得含蓄又直白。', at: now - 80 * H }], 90),
    p('p07', 'u11', '画了一组「城南旧事」插画,画到巷口卖花的老奶奶,她总说:「姑娘,买支花吧,等人的人最配花。」我把这句话画进了画里。', '国风美学', [pic('sy-post-alley')], ['u01', 'u05', 'u09', 'u07'], [], 110),
    p('p08', 'u12', '修一张明代仲尼式古琴,断纹如梅花。琴主说这是他祖父的遗物,想修好传给孙辈。器物尚且有人等着传承,人更该有人等着相逢。', '国风美学', [pic('sy-post-guqin')], ['u01', 'u07', 'u04'], [{ id: 'c07', authorId: 'u01', text: '断纹如梅花,这句话真美。', at: now - 130 * H }], 140),
    p('p09', 'u01', '穿了最爱的赤红襦裙去赴诗会。有人说我像从诗里走出来的人,我答:背了那么多诗,总算有处可去了。', '汉服', [faceOf('u01')], ['u12', 'u07', 'u09', 'u04'], [{ id: 'c08', authorId: 'u12', text: '红衣配诗,两样都炽烈。', at: now - 2 * H }], 3, true),
    p('p10', 'u09', '在展厅拍了一组汉服照,千年前的织锦与身上的裙裾,那一刻是同一种温度。下次若有人同行,团扇借你。', '汉服', [faceOf('u09')], ['u01', 'u07', 'u11', 'u12'], [{ id: 'c09', authorId: 'u07', text: '借团扇的人,多半是想借个同行。', at: now - 10 * H }], 12, true),
    p('p11', 'u12', '着深色圆领袍修琴一日,客人笑我比古琴还古。修毕留影一张——老东西值得穿在身上、放在心上。', '汉服', [faceOf('u12')], ['u01', 'u09', 'u04'], [], 20),
  ]
}

export function seedEvents(): EventItem[] {
  const now = Date.now()
  return [
    { id: 'e01', title: '西湖诗会 · 中秋场', city: '杭州', cover: scene('lake', '#5d4a6e', '#d9a05b'), date: '2026-09-12', time: '14:00', capacity: 20, desc: '泛舟湖上,飞花令与茶席相佐。一人一句诗,诗尽处,或许就是缘起处。含茶点与船资。', tags: ['诗词', '茶艺'], attendees: ['u01', 'u07', 'u12', 'u04'], host: '随缘网 · 官方牵线', comments: [
      { id: 'ec01', authorId: 'u07', text: '飞花令我来出题,月字飞花,谁接不住谁煮茶。', at: now - 40 * H },
      { id: 'ec02', authorId: 'u12', text: '带了一张琴去,湖上弹《秋水》,算我给诗会的见面礼。', at: now - 30 * H },
    ] },
    { id: 'e02', title: '天平山登高寻枫', city: '苏州', cover: scene('mountains', '#2f5d4a', '#a8c9a0'), date: '2026-09-19', time: '08:30', capacity: 16, desc: '早枫初染,结伴登山。途中设「同心锁」小任务,两人一组共解山间谜题,下山共品一碗头汤面。', tags: ['登山', '美食'], attendees: ['u04', 'u10', 'u03'], host: '随缘网 · 官方牵线' },
    { id: 'e03', title: '国风桌游之夜', city: '上海', cover: scene('board', '#6b3a2a', '#d9a05b'), date: '2026-09-05', time: '19:00', capacity: 12, desc: '《孔明棋》《兰亭序》桌游专场,新手友好。输赢不重要,重要的是你对面坐的那个人。', tags: ['桌游', '国风'], attendees: ['u11', 'u06', 'u05', 'u08', 'u02'], host: '随缘网 × 拾光桌游馆' },
    { id: 'e04', title: '汉服 City Walk · 秦淮月', city: '南京', cover: scene('lantern', '#7a1622', '#3c0d13'), date: '2026-09-26', time: '17:30', capacity: 24, desc: '着汉服夜游秦淮,提灯、猜谜、听评弹。提供汉服租赁与妆造,零基础可报名。', tags: ['国风', '汉服', '看展'], attendees: ['u07', 'u09', 'u01'], host: '随缘网 × 金陵汉服社', comments: [
      { id: 'ec03', authorId: 'u09', text: '妆造我来帮忙,想穿唐制的姐妹提前说,我带发冠。', at: now - 20 * H },
    ] },
    { id: 'e05', title: '博物馆奇妙夜 · 长安', city: '西安', cover: scene('museum', '#3a3f3c', '#8a9a8e'), date: '2026-10-01', time: '18:00', capacity: 18, desc: '闭馆后的特展讲解,由会员中的讲解员亲自带场。看完千年文物,聊聊我们想留下的故事。', tags: ['看展', '旅行'], attendees: ['u09'], host: '随缘网 · 官方牵线' },
  ]
}

export function seedDigests(): WeeklyDigest[] {
  return [{
    id: 'dg1',
    issue: weekNo(),
    title: '罗裙与故人',
    intro: '这一周的缘,藏在裙裾与墨色里:有人着赤红襦裙赴诗会,有人替千年古琴续上断纹,有人把长安讲给你听。四篇精选,见字如面。',
    postIds: ['p09', 'p10', 'p11', 'p08'],
    at: Date.now() - 12 * H,
    cover: scene('lantern', '#7a1622', '#d9a05b'),
    views: 26,
  }]
}

export const SEED_IDS = new Set(seedUsers().map(u => u.id))
export const SEED_POST_IDS = new Set(seedPosts().map(p => p.id))
export const SEED_EVENT_IDS = new Set(seedEvents().map(e => e.id))
export const SEED_DIGEST_IDS = new Set(seedDigests().map(d => d.id))
