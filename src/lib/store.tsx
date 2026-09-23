import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { portrait, scene } from './art'
import { ALL_CITIES, districtOf } from './region'
import { getLocalAccount, onLocalAccountChange, logoutLocalAccount } from './localAuth'
import type { LocalAccount } from './localAuth'
import { loadWorld, syncWorld, bumpDigestView, adminResetPassword } from './repo'
import { uploadImage } from './upload'
import type { FestTemplate } from './festivals'

export type Gender = 'male' | 'female'

export interface Verification {
  phone: boolean
  realname: boolean
  photo: boolean
}

export interface User {
  id: string
  phone: string
  password: string
  nickname: string
  gender: Gender
  seeking: Gender
  birthDate: string
  city: string
  region?: string
  height: number
  job: string
  bio: string
  interests: string[]
  photos: string[]
  verification: Verification
  /** 每枚成就的获得时间(badge id -> 毫秒时间戳) */
  badgeDates?: Record<string, number>
  createdAt: number
  stealth?: boolean
  role?: 'admin'
  banned?: boolean
}

export interface ChatMsg {
  id: string
  from: string
  text: string
  at: number
  read?: boolean
  recalled?: boolean
  /** 图片消息(单张, 兼容旧存档) */
  image?: string
  /** 图片消息(最多九张) */
  images?: string[]
}

interface MatchState {
  likes: Record<string, string[]>
  passes: Record<string, string[]>
  chats: Record<string, ChatMsg[]>
  reads: Record<string, number>
}

export interface PostComment {
  id: string
  authorId: string
  text: string
  at: number
  likes?: string[]
  pinned?: boolean
}

export interface Post {
  id: string
  authorId: string
  text: string
  images: string[]
  topic: string
  featured?: boolean
  likes: string[]
  comments: PostComment[]
  at: number
}

export interface EventItem {
  id: string
  title: string
  city: string
  cover: string
  date: string
  time: string
  capacity: number
  desc: string
  tags: string[]
  attendees: string[]
  host: string
  /** 发起人用户 id; 平台官方活动无此字段, 仅发起人本人可编辑/删除 */
  creatorId?: string
  /** 活动要求, 如着装、年龄、人数说明等 */
  requirements?: string
  /** 发起人置顶 */
  pinned?: boolean
  /** 活动相册(封面之外的补充图片) */
  images?: string[]
  /** 完整地区展示串, 如 浙江省·杭州市·西湖区 */
  region?: string
  /** 活动评论区 */
  comments?: PostComment[]
}

export type FavType = 'users' | 'posts' | 'events'

export interface Favs {
  users: string[]
  posts: string[]
  events: string[]
}

export interface Visit {
  id: string
  at: number
}

export interface ReportRec {
  id: string
  by: string
  target: string
  reason: string
  note: string
  at: number
  status?: 'open' | 'done'
}

/** 每周精选合集: 掌柜每周把优质帖文打包成一期 */
export interface WeeklyDigest {
  id: string
  issue: number
  title: string
  intro: string
  postIds: string[]
  at: number
  /** 本期封面, 不传则用纯红笺门面 */
  cover?: string
  /** 多封面(轮播), 首张为主封面 */
  covers?: string[]
  /** 被翻阅次数, 读者点开合集即累计 */
  views: number
}

export const REPORT_REASONS = ['虚假资料或冒充他人', '言语骚扰或辱骂', '诈骗或索要钱财', '发布不当内容', '其他原因']

export const TOPICS = ['慢生活', '山与海', '诗与远方', '食记', '国风美学', '汉服']

export const INTERESTS = ['诗词', '摄影', '旅行', '美食', '茶艺', '音乐', '书法', '电影', '登山', '烹饪', '围棋', '国风', '汉服', '瑜伽', '骑行', '看展', '桌游']

/* 交友安全: 涉财/涉隐私敏感词, 命中时给用户温馨提醒 */
const RISK_WORDS = ['转账', '汇款', '投资', '理财', '返利', '刷单', '借钱', '验证码', '保证金', '解冻', '稳赚', '银行卡密码']
export const riskWord = (text: string) => RISK_WORDS.find(w => text.includes(w)) ?? null

export const CITIES = ALL_CITIES

/** 佳音墙(成功故事)卡片 */
export interface Story {
  img: string
  quote: string
  names: string
  city: string
}

export type FeatureKey = 'yuanfen' | 'explore' | 'events' | 'community' | 'matches'

export interface Settings {
  features: Record<FeatureKey, boolean>
  stories: Story[]
  announcement: string
  /** 管理员隐藏不展示的活动 id 列表 */
  hiddenEvents: string[]
  /** 掌柜自定义的佳节模板(以佳节名为键, 未定制时用内置文案) */
  festTemplates: Record<string, FestTemplate>
}

export const DEFAULT_SETTINGS: Settings = {
  features: { yuanfen: true, explore: true, events: true, community: true, matches: true },
  stories: [
    { img: 'https://picsum.photos/seed/sy-couple-1/600/450', quote: '第一次「随缘分配」就把我们分到了一起。他开口第一句是:你也喜欢这首诗?后来,这首诗成了我们婚礼的请柬题词。', names: '陈先生 & 林小姐', city: '杭州 · 相识 412 天' },
    { img: 'https://picsum.photos/seed/sy-couple-2/600/450', quote: '我们都爱看展、爱拍照,契合度 92%。第一次见面在博物馆,他讲了两个小时的敦煌,我在旁边听了两个小时的心动。', names: '赵先生 & 顾小姐', city: '南京 · 相识 268 天' },
    { img: 'https://picsum.photos/seed/sy-couple-3/600/450', quote: '资料验证让我很安心,遇到的每个人都是真实的。缘字一事从不强求,但在这里,它真的来了。', names: '王先生 & 苏小姐', city: '苏州 · 相识 157 天' },
  ],
  announcement: '',
  hiddenEvents: [],
  festTemplates: {},
}

export const FEATURE_META: Array<{ key: FeatureKey; label: string; desc: string }> = [
  { key: 'yuanfen', label: '随缘分配', desc: '每日为你分配三位有缘人' },
  { key: 'explore', label: '兴趣匹配', desc: '按兴趣与契合度寻知音' },
  { key: 'events', label: '活动牵线', desc: '线下主题活动报名' },
  { key: 'community', label: '社区分享', desc: '会员动态与佳音墙' },
  { key: 'matches', label: '我的佳音', desc: '聊天与往来消息' },
]

export function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

export function ageOf(birthDate: string): number {
  const b = new Date(birthDate)
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--
  return a
}

/** 距活动日期还有几天(当天为 0,已过期为负) */
export function daysUntil(date: string): number {
  const d = new Date(`${date}T00:00:00`)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((d.getTime() - today.getTime()) / 86400_000)
}

/** 资料完善度:0-100 分,附待补项提示 */
export function completeness(u: User): { pct: number; tips: Array<{ text: string; pts: number; to?: string }> } {
  const tips: Array<{ text: string; pts: number; to?: string }> = []
  let score = 0
  // 照片 25 分
  const n = u.photos.length
  const pPts = n >= 3 ? 25 : n === 2 ? 18 : n === 1 ? 10 : 0
  score += pPts
  if (pPts < 25) tips.push({ text: n === 0 ? '上传照片,让有缘人先看见你' : '再补几张照片(3 张以上),印象更立体', pts: 25 - pPts })
  // 自我介绍 25 分
  const bio = u.bio.trim()
  const emptyBio = !bio || bio === '这个人很神秘,还没写自我介绍。'
  const bPts = emptyBio ? 0 : bio.length >= 30 ? 25 : bio.length >= 10 ? 15 : 8
  score += bPts
  if (bPts < 25) tips.push({ text: emptyBio ? '写一段走心的自我介绍,30 字以上更佳' : '自我介绍再丰富些,可用一键润色帮帮忙', pts: 25 - bPts })
  // 兴趣爱好 15 分
  const iPts = u.interests.length >= 5 ? 15 : u.interests.length >= 3 ? 8 : 0
  score += iPts
  if (iPts < 15) tips.push({ text: '多勾选几个兴趣爱好,让同好更容易找到你', pts: 15 - iPts })
  // 三重验证 25 分
  const v = Object.values(u.verification).filter(Boolean).length
  const vPts = v * 8 + (v === 3 ? 1 : 0)
  score += vPts
  if (vPts < 25) tips.push({ text: '完成三重验证,点亮徽章、优先展示', pts: 25 - vPts, to: '/verify' })
  // 职业 10 分
  const jPts = u.job && u.job !== '保密' ? 10 : 0
  score += jPts
  if (jPts < 10) tips.push({ text: '填写职业信息,聊天更好开口', pts: 10 - jPts })
  return { pct: Math.min(100, score), tips }
}

/* 演示素材: 人物头像用随包内置的真人质感照片, 生活照/活动图用离线意象场景 */
const FACE: Record<string, string> = {
  // p01-p06 为用户提供的真人照片, 按人设气质分配
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

function seedUsers(): User[] {
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

function seedPosts(): Post[] {
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

function seedEvents(): EventItem[] {
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

/** 当前是一年中的第几周, 作为合集期号 */
export function weekNo(): number {
  const d = new Date()
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - start.getTime()) / 86400_000 + start.getDay() + 1) / 7)
}

function seedDigests(): WeeklyDigest[] {
  return [
    {
      id: 'dg1',
      issue: weekNo(),
      title: '罗裙与故人',
      intro: '这一周的缘,藏在裙裾与墨色里:有人着赤红襦裙赴诗会,有人替千年古琴续上断纹,有人把长安讲给你听。四篇精选,见字如面。',
      postIds: ['p09', 'p10', 'p11', 'p08'],
      at: Date.now() - 12 * H,
      cover: scene('lantern', '#7a1622', '#d9a05b'),
      views: 26,
    },
  ]
}

interface Store {
  users: User[]
  me: User | null
  /** 当前自建登录账号, 未登录为 null */
  account: LocalAccount | null
  /** 数据库水合是否完成 */
  booted: boolean
  match: MatchState
  logout: () => void
  update: (patch: Partial<User>) => void
  addPhotos: (urls: string[]) => void
  removePhoto: (index: number) => void
  setAvatar: (index: number) => void
  reorderPhotos: (from: number, to: number) => void
  setVerify: (key: keyof Verification) => void
  like: (otherId: string) => boolean
  /** 撤回一次「有意」 */
  unlike: (otherId: string) => void
  /** 收回一次「且过」, 此缘复还 */
  unpass: (otherId: string) => void
  pass: (otherId: string) => void
  likesOf: (uid: string) => string[]
  passesOf: (uid: string) => string[]
  mutuals: () => User[]
  conversations: () => Array<{ user: User; lastAt: number; lastText: string; lastFrom: string; liked: boolean }>
  unread: (otherId: string) => number
  markRead: (otherId: string) => void
  matchParts: (other: User) => { shared: number; sharedPts: number; agePts: number; cityPts: number; districtPts: number; verifyPts: number }
  isMutual: (otherId: string) => boolean
  chatWith: (otherId: string) => ChatMsg[]
  sendChat: (otherId: string, text: string, images?: string[]) => void
  pushReply: (otherId: string, text: string) => void
  posts: Post[]
  events: EventItem[]
  publish: (text: string, images: string[], topic: string) => void
  togglePostLike: (postId: string) => void
  addComment: (postId: string, text: string) => void
  /** 删除一条回帖: 仅回帖作者或掌柜可操作 */
  removeComment: (postId: string, commentId: string) => boolean
  togglePostFeatured: (postId: string) => boolean
  /** 删除违规帖: 仅掌柜可操作 */
  removePost: (postId: string) => boolean
  /** 掌柜编辑帖子正文 */
  adminEditPostText: (postId: string, text: string) => boolean
  digests: WeeklyDigest[]
  publishDigest: (data: { title: string; intro: string; postIds: string[]; cover?: string; covers?: string[] }) => boolean
  removeDigest: (id: string) => boolean
  /** 读者翻开某期合集时累计一次阅读 */
  viewDigest: (id: string) => void
  joinEvent: (eventId: string, contact?: string) => void
  leaveEvent: (eventId: string) => void
  /** 报名者留的联系方式: eventId -> userId -> 联系方式, 仅发起人可见 */
  contacts: Record<string, Record<string, string>>
  createEvent: (data: Omit<EventItem, 'id' | 'attendees' | 'host' | 'creatorId'>) => string | null
  updateEvent: (eventId: string, patch: Partial<EventItem>) => boolean
  deleteEvent: (eventId: string) => boolean
  togglePinEvent: (eventId: string) => boolean
  favs: Favs
  toggleFav: (type: FavType, id: string) => void
  isFav: (type: FavType, id: string) => boolean
  favGroups: string[]
  favGroupOf: (itemId: string) => string
  addFavGroup: (name: string) => string | null
  removeFavGroup: (name: string) => void
  renameFavGroup: (oldName: string, newName: string) => string | null
  setFavGroup: (itemId: string, group: string) => void
  composerDraft: string
  setComposerDraft: (text: string) => void
  recallMsg: (otherId: string, msgId: string) => void
  addEventComment: (eventId: string, text: string) => void
  toggleEventCommentLike: (eventId: string, commentId: string) => void
  toggleEventCommentPin: (eventId: string, commentId: string) => boolean
  deleteEventComment: (eventId: string, commentId: string) => boolean
  recordVisit: (viewedId: string) => void
  visitorsOf: (uid: string) => Array<{ user: User; at: number }>
  /** 足迹表: 被浏览者 -> 访客列表 */
  visits: Record<string, Visit[]>
  blocks: string[]
  isBlocked: (uid: string) => boolean
  toggleBlock: (uid: string) => void
  reportUser: (uid: string, reason: string, note: string) => void
  resolveReport: (reportId: string, action: 'ban' | 'dismiss') => boolean
  unbanUser: (uid: string) => boolean
  banUser: (uid: string) => boolean
  /** 掌柜重置会员密码: 返回一次性临时密码(失败返回 null), 明文只展示一次 */
  resetMemberPassword: (uid: string) => Promise<string | null>
  /** 掌柜直接替换会员头像, 全站即时生效 */
  adminSetUserPhoto: (uid: string, dataUrl: string) => boolean
  /** 掌柜替换活动封面图 */
  adminSetEventCover: (eventId: string, dataUrl: string) => boolean
  /** 掌柜维护帖子图片(可增删) */
  adminSetPostImages: (postId: string, images: string[]) => boolean
  /** 掌柜清理聊天图片释放空间, 返回清理张数 */
  purgeChatImages: () => number
  adminLogs: Array<{ id: string; at: number; text: string }>
  reports: ReportRec[]
  checkins: Record<string, string[]>
  checkinEvent: (eventId: string) => boolean
  tour: Record<string, boolean>
  markTour: (key: string) => void
  reminders: string[]
  toggleReminder: (eventId: string) => void
  upcomingReminded: () => Array<{ event: EventItem; days: number }>
  icebreakerFor: (other: User) => string
  candidates: () => User[]
  dailyYuanfen: () => User[]
  matchScore: (other: User) => number
  settings: Settings
  saveSettings: (patch: Partial<Settings>) => boolean
  featureOn: (k: FeatureKey) => boolean
  toggleEventHidden: (eventId: string) => boolean
}

const SEED_IDS = new Set(seedUsers().map(u => u.id))

/** 数据库版本优先, 补齐缺漏的官方种子行(自愈) */
function mergeById<T extends { id: string }>(db: T[], seed: T[]): T[] {
  const ids = new Set(db.map(x => x.id))
  return [...db, ...seed.filter(s => !ids.has(s.id))]
}

/** 由自建账号生成会员档案(首个真实账号成为掌柜) */
function makeMember(acc: LocalAccount, firstAdmin: boolean): User {
  return {
    id: acc.id,
    phone: '',
    password: '',
    nickname: acc.name || acc.email.split('@')[0],
    gender: 'female',
    seeking: 'male',
    birthDate: '1995-01-01',
    city: '杭州',
    height: 165,
    job: '自由职业',
    bio: '初来随缘网,请多关照。',
    interests: [],
    photos: [portrait((acc.name || acc.email)[0] ?? '缘', '#8f1d2c', '#d9a05b', 'moon')],
    verification: { phone: false, realname: false, photo: false },
    createdAt: Date.now(),
    role: firstAdmin ? 'admin' : undefined,
  }
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  // 数据初始为本地种子/默认值; 登录后从数据库水合覆盖, 改动再写回数据库
  const [account, setAccount] = useState<LocalAccount | null>(() => getLocalAccount())
  const [booted, setBooted] = useState(false)
  const [users, setUsers] = useState<User[]>(() => seedUsers())
  const [match, setMatch] = useState<MatchState>({ likes: {}, passes: {}, chats: {}, reads: {} })
  const [posts, setPosts] = useState<Post[]>(() => seedPosts())
  const [events, setEvents] = useState<EventItem[]>(() => seedEvents())
  const [reminders, setReminders] = useState<string[]>([])
  const [favs, setFavs] = useState<Favs>({ users: [], posts: [], events: [] })
  const [favmeta, setFavmeta] = useState<{ groups: string[]; of: Record<string, string> }>({ groups: [], of: {} })
  const [composerDraft, setComposerDraftState] = useState('')
  const [adminLogs, setAdminLogs] = useState<Array<{ id: string; at: number; text: string }>>([])
  const [visits, setVisits] = useState<Record<string, Visit[]>>({})
  const [blocks, setBlocks] = useState<string[]>([])
  const [reports, setReports] = useState<ReportRec[]>([])
  const [checkins, setCheckins] = useState<Record<string, string[]>>({})
  const [digests, setDigests] = useState<WeeklyDigest[]>(() => seedDigests())
  const [tour, setTour] = useState<Record<string, boolean>>({})
  const [settings, setSettings] = useState<Settings>(() => structuredClone(DEFAULT_SETTINGS))
  const [contacts, setContacts] = useState<Record<string, Record<string, string>>>({})

  // 掌柜操作日志(数据库留存最近 100 条)
  const logOp = (text: string) =>
    setAdminLogs(prev => [{ id: `lg${Date.now().toString(36)}${prev.length % 100}`, at: Date.now(), text }, ...prev].slice(0, 100))

  // 订阅登录态; 退出时清空私有数据缓存
  useEffect(
    () =>
      onLocalAccountChange(a => {
        setAccount(a)
        if (!a) {
          setMatch({ likes: {}, passes: {}, chats: {}, reads: {} })
          setFavs({ users: [], posts: [], events: [] })
          setFavmeta({ groups: [], of: {} })
          setVisits({})
          setBlocks([])
          setReminders([])
          setCheckins({})
          setContacts({})
          setTour({})
        }
      }),
    [],
  )

  // 水合: 登录后按表拉取; 服务器为空则把种子世界逐表迁上去; 并保证账号有会员档案
  useEffect(() => {
    let alive = true
    const boot = async () => {
      try {
        let world = await loadWorld(account?.id ?? null)
        if (world.empty && account) {
          await syncWorld(
            {
              users,
              posts,
              events,
              settings,
              digests,
              reports: [],
              adminLogs: [],
              match: { likes: {}, passes: {}, chats: {}, reads: {} },
              favs: { users: [], posts: [], events: [] },
              favmeta: { groups: [], of: {} },
              visits: {},
              blocks: [],
              reminders: [],
              checkins: {},
              contacts: {},
              tour: {},
            },
            account.id,
            SEED_IDS,
          )
          world = await loadWorld(account.id)
        }
        if (!alive) return
        if (world.users.length) setUsers(mergeById(world.users, seedUsers()))
        if (world.posts.length) setPosts(mergeById(world.posts, seedPosts()))
        if (world.events.length) setEvents(mergeById(world.events, seedEvents()))
        if (world.settings) setSettings(world.settings)
        if (world.digests.length) setDigests(world.digests)
        setReports(world.reports)
        setAdminLogs(world.adminLogs)
        if (account) {
          const acc = account
          setUsers(prev => (prev.some(u => u.id === acc.id) ? prev : [...prev, makeMember(acc, !prev.some(u => u.role === 'admin' && !SEED_IDS.has(u.id)))]))
          setMatch(world.match)
          setFavs(world.favs)
          setFavmeta(world.favmeta)
          setVisits(world.visits)
          setBlocks(world.blocks)
          setReminders(world.reminders)
          setCheckins(world.checkins)
          setContacts(world.contacts)
          setTour(world.tour)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('账号已停用')) {
          // 服务端封禁强制(v1.6):被停用账号的会话直接登出并告知原因
          logoutLocalAccount()
          toast.error('该账号已被停用,如有疑问请联系掌柜')
        } else if (msg.includes('请重新登录')) {
          // 改密/重置后旧令牌即时失效(v1.8):登出并引导重新登录
          logoutLocalAccount()
          toast.error('登录状态已失效,请重新登录')
        } else if (alive) {
          toast.error('数据库连接失败,当前展示临时数据,稍后可刷新重试')
        }
      }
      if (alive) setBooted(true)
    }
    void boot()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id])

  // 全量状态差量写回各表(0.8 秒防抖; 私有表只写自己的行)
  useEffect(() => {
    if (!booted || !account) return
    const t = setTimeout(() => {
      void syncWorld(
        { users, posts, events, settings, digests, reports, adminLogs, match, favs, favmeta, visits, blocks, reminders, checkins, contacts, tour },
        account.id,
        SEED_IDS,
      ).catch(() => toast.error('保存未成功,数据库写入异常'))
    }, 800)
    return () => clearTimeout(t)
  }, [users, posts, events, settings, digests, reports, adminLogs, match, favs, favmeta, visits, blocks, reminders, checkins, contacts, tour, booted, account])

  const me = users.find(u => u.id === account?.id) ?? null

  const patchMe = (fn: (u: User) => User) => {
    setUsers(prev => prev.map(u => (u.id === account?.id ? fn(u) : u)))
  }

  const store: Store = {
    users,
    me,
    account,
    booted,
    match,
    visits,
    logout() {
      logoutLocalAccount()
    },
    update(patch) {
      patchMe(u => ({ ...u, ...patch }))
    },
    addPhotos(urls) {
      patchMe(u => ({ ...u, photos: [...u.photos, ...urls].slice(0, 6) }))
    },
    removePhoto(index) {
      patchMe(u => ({ ...u, photos: u.photos.filter((_, i) => i !== index) }))
    },
    setAvatar(index) {
      patchMe(u => {
        const target = u.photos[index]
        if (!target || index === 0) return u
        return { ...u, photos: [target, ...u.photos.filter((_, i) => i !== index)] }
      })
    },
    reorderPhotos(from, to) {
      // 拖拽语义: 被拖照片落到目标格子 to 的位置
      patchMe(u => {
        if (from === to || from < 0 || to < 0 || from >= u.photos.length || to >= u.photos.length) return u
        const next = [...u.photos]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return { ...u, photos: next }
      })
    },
    setVerify(key) {
      patchMe(u => ({ ...u, verification: { ...u.verification, [key]: true } }))
    },
    likesOf: uid => match.likes[uid] ?? [],
    passesOf: uid => match.passes[uid] ?? [],
    like(otherId) {
      if (!me) return false
      const mine = match.likes[me.id] ?? []
      if (!mine.includes(otherId)) {
        setMatch(prev => ({ ...prev, likes: { ...prev.likes, [me.id]: [...(prev.likes[me.id] ?? []), otherId] } }))
      }
      const back = (match.likes[otherId] ?? []).includes(me.id) || hashStr(me.id + otherId) % 10 < 6
      return back
    },
    unlike(otherId) {
      if (!me) return
      setMatch(prev => ({ ...prev, likes: { ...prev.likes, [me.id]: (prev.likes[me.id] ?? []).filter(x => x !== otherId) } }))
    },
    unpass(otherId) {
      if (!me) return
      setMatch(prev => ({ ...prev, passes: { ...prev.passes, [me.id]: (prev.passes[me.id] ?? []).filter(x => x !== otherId) } }))
    },
    pass(otherId) {
      if (!me) return
      setMatch(prev => ({ ...prev, passes: { ...prev.passes, [me.id]: [...(prev.passes[me.id] ?? []), otherId] } }))
    },
    mutuals() {
      if (!me) return []
      const mine = match.likes[me.id] ?? []
      return users.filter(u => mine.includes(u.id) && (match.likes[u.id] ?? []).includes(me.id))
    },
    conversations() {
      if (!me) return []
      const out: Array<{ user: User; lastAt: number; lastText: string; lastFrom: string; liked: boolean }> = []
      for (const [key, msgs] of Object.entries(match.chats)) {
        const [a, b] = key.split(':')
        if (a !== me.id && b !== me.id) continue
        const otherId = a === me.id ? b : a
        const u = users.find(x => x.id === otherId)
        if (!u || !msgs.length) continue
        const last = msgs[msgs.length - 1]
        out.push({ user: u, lastAt: last.at, lastText: last.text, lastFrom: last.from, liked: false })
      }
      const mine = match.likes[me.id] ?? []
      for (const u of users) {
        if (mine.includes(u.id) && !out.some(o => o.user.id === u.id)) {
          out.push({ user: u, lastAt: 0, lastText: '', lastFrom: '', liked: true })
        }
      }
      return out.map(o => ({ ...o, liked: o.liked || mine.includes(o.user.id) })).sort((x, y) => y.lastAt - x.lastAt)
    },
    unread(otherId) {
      if (!me) return 0
      const key = [me.id, otherId].sort().join(':')
      const readAt = match.reads[key] ?? 0
      return (match.chats[key] ?? []).filter(m => m.from !== me.id && m.at > readAt).length
    },
    markRead(otherId) {
      if (!me) return
      const key = [me.id, otherId].sort().join(':')
      setMatch(prev => ({ ...prev, reads: { ...prev.reads, [key]: Date.now() } }))
    },
    matchParts(other) {
      if (!me) return { shared: 0, sharedPts: 0, agePts: 0, cityPts: 0, districtPts: 0, verifyPts: 0 }
      const shared = me.interests.filter(i => other.interests.includes(i)).length
      const diff = Math.abs(ageOf(me.birthDate) - ageOf(other.birthDate))
      const vf = (u: User) => u.verification.phone && u.verification.realname && u.verification.photo
      const myDistrict = districtOf(me)
      const sameDistrict = myDistrict !== '' && districtOf(other) === myDistrict && me.city === other.city
      return {
        shared,
        sharedPts: Math.min(32, shared * 8),
        agePts: diff <= 2 ? 10 : diff <= 5 ? 6 : 2,
        cityPts: me.city === other.city ? 7 : 0,
        districtPts: sameDistrict ? 4 : 0,
        verifyPts: vf(me) && vf(other) ? 5 : 0,
      }
    },
    isMutual(otherId) {
      if (!me) return false
      return (match.likes[me.id] ?? []).includes(otherId) && (match.likes[otherId] ?? []).includes(me.id)
    },
    chatWith(otherId) {
      if (!me) return []
      return match.chats[[me.id, otherId].sort().join(':')] ?? []
    },
    sendChat(otherId, text, images) {
      if (!me) return
      const key = [me.id, otherId].sort().join(':')
      const msg: ChatMsg = { id: `${Date.now()}`, from: me.id, text, at: Date.now(), images: images?.length ? images : undefined }
      setMatch(prev => ({ ...prev, chats: { ...prev.chats, [key]: [...(prev.chats[key] ?? []), msg] } }))
    },
    pushReply(otherId, text) {
      if (!me) return
      const key = [me.id, otherId].sort().join(':')
      const msg: ChatMsg = { id: `${Date.now()}r`, from: otherId, text, at: Date.now() }
      // 对方回信即视为已读我方此前的消息
      setMatch(prev => {
        const readUp = (prev.chats[key] ?? []).map(m => (m.from === me.id ? { ...m, read: true } : m))
        return { ...prev, chats: { ...prev.chats, [key]: [...readUp, msg] } }
      })
    },
    posts,
    events,
    reports,
    adminLogs,
    checkins,
    checkinEvent(eventId) {
      if (!me) return false
      const ev = events.find(e => e.id === eventId)
      if (!ev || !ev.attendees.includes(me.id)) return false
      setCheckins(prev => {
        const mine = prev[me.id] ?? []
        return mine.includes(eventId) ? prev : { ...prev, [me.id]: [...mine, eventId] }
      })
      return true
    },
    publish(text, images, topic) {
      if (!me) return
      const post: Post = { id: `pm${Date.now().toString(36)}`, authorId: me.id, text, images, topic, likes: [], comments: [], at: Date.now() }
      setPosts(prev => [post, ...prev])
    },
    togglePostLike(postId) {
      if (!me) return
      setPosts(prev => prev.map(p => (p.id === postId ? { ...p, likes: p.likes.includes(me.id) ? p.likes.filter(x => x !== me.id) : [...p.likes, me.id] } : p)))
    },
    addComment(postId, text) {
      if (!me) return
      const c: PostComment = { id: `cm${Date.now().toString(36)}`, authorId: me.id, text, at: Date.now() }
      setPosts(prev => prev.map(p => (p.id === postId ? { ...p, comments: [...p.comments, c] } : p)))
    },
    removeComment(postId, commentId) {
      if (!me) return false
      const p = posts.find(x => x.id === postId)
      const c = p?.comments.find(x => x.id === commentId)
      // 权限: 仅回帖作者本人或掌柜可删
      if (!p || !c || (c.authorId !== me.id && me.role !== 'admin')) return false
      setPosts(prev => prev.map(x => (x.id === postId ? { ...x, comments: x.comments.filter(cm => cm.id !== commentId) } : x)))
      return true
    },
    togglePostFeatured(postId) {
      if (me?.role !== 'admin') return false
      const was = posts.find(p => p.id === postId)?.featured
      logOp(was ? '取消了一篇精选帖' : '将一篇帖子设为精选')
      setPosts(prev => prev.map(p => (p.id === postId ? { ...p, featured: !p.featured } : p)))
      return true
    },
    removePost(postId) {
      if (me?.role !== 'admin') return false
      const t = posts.find(p => p.id === postId)
      if (!t) return false
      logOp(`删除违规帖:${t.text.slice(0, 12)}`)
      setPosts(prev => prev.filter(p => p.id !== postId))
      // 顺带清掉收藏里的引用, 避免留下失效条目
      setFavs(prev => ({ ...prev, posts: prev.posts.filter(x => x !== postId) }))
      return true
    },
    adminEditPostText(postId, text) {
      if (me?.role !== 'admin') return false
      const t = posts.find(p => p.id === postId)
      const next = text.trim()
      if (!t || !next) return false
      logOp(`编辑帖子文字:${next.slice(0, 12)}`)
      setPosts(prev => prev.map(p => (p.id === postId ? { ...p, text: next } : p)))
      return true
    },
    digests,
    publishDigest(data) {
      if (me?.role !== 'admin') return false
      const title = data.title.trim()
      if (!title || !data.postIds.length) return false
      logOp(`发布每周精选合集「${title}」(收录 ${data.postIds.length} 篇)`)
      setDigests(prev =>
        [
          {
            id: `dg${Date.now().toString(36)}`,
            issue: Math.max(0, ...prev.map(d => d.issue)) + 1,
            title,
            intro: data.intro.trim(),
            postIds: data.postIds,
            at: Date.now(),
            cover: data.cover || undefined,
            covers: data.covers?.length ? data.covers : undefined,
            views: 0,
          },
          ...prev,
        ].slice(0, 8),
      )
      return true
    },
    removeDigest(id) {
      if (me?.role !== 'admin') return false
      const d = digests.find(x => x.id === id)
      if (!d) return false
      logOp(`撤下每周精选合集「${d.title}」`)
      setDigests(prev => prev.filter(x => x.id !== id))
      return true
    },
    viewDigest(id) {
      setDigests(prev => prev.map(d => (d.id === id ? { ...d, views: (d.views ?? 0) + 1 } : d)))
      // 计数走服务端原子自增端点持久化（本地状态先加一保证界面即时）
      void bumpDigestView(id)
    },
    joinEvent(eventId, contact) {
      if (!me) return
      setEvents(prev => prev.map(e => (e.id === eventId && !e.attendees.includes(me.id) && e.attendees.length < e.capacity ? { ...e, attendees: [...e.attendees, me.id] } : e)))
      // 报名即设提醒,开演前在日历里提示
      setReminders(prev => (prev.includes(eventId) ? prev : [...prev, eventId]))
      if (contact && contact.trim()) {
        setContacts(prev => ({ ...prev, [eventId]: { ...(prev[eventId] ?? {}), [me.id]: contact.trim() } }))
      }
    },
    leaveEvent(eventId) {
      if (!me) return
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, attendees: e.attendees.filter(x => x !== me.id) } : e)))
    },
    createEvent(data) {
      if (!me) return null
      const id = `ev${Date.now().toString(36)}`
      const ev: EventItem = { ...data, id, attendees: [me.id], host: `${me.nickname} · 会员发起`, creatorId: me.id }
      setEvents(prev => [...prev, ev])
      return id
    },
    updateEvent(eventId, patch) {
      if (!me) return false
      const target = events.find(e => e.id === eventId)
      // 权限: 仅发起人本人可改自己的活动
      if (!target || target.creatorId !== me.id) return false
      const rest: Partial<EventItem> = { ...patch }
      delete rest.id
      delete rest.attendees
      delete rest.creatorId
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, ...rest } : e)))
      return true
    },
    deleteEvent(eventId) {
      if (!me) return false
      const target = events.find(e => e.id === eventId)
      if (!target || target.creatorId !== me.id) return false
      setEvents(prev => prev.filter(e => e.id !== eventId))
      setReminders(prev => prev.filter(x => x !== eventId))
      return true
    },
    togglePinEvent(eventId) {
      if (!me) return false
      const target = events.find(e => e.id === eventId)
      if (!target || target.creatorId !== me.id) return false
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, pinned: !e.pinned } : e)))
      return true
    },
    reminders,
    contacts,
    toggleReminder(eventId) {
      setReminders(prev => (prev.includes(eventId) ? prev.filter(x => x !== eventId) : [...prev, eventId]))
    },
    upcomingReminded() {
      return reminders
        .map(id => events.find(e => e.id === id))
        .filter((e): e is EventItem => !!e)
        .map(event => ({ event, days: daysUntil(event.date) }))
        .filter(x => x.days >= 0)
        .sort((a, b) => a.days - b.days)
    },
    favs,
    toggleFav(type, id) {
      setFavs(prev => ({ ...prev, [type]: prev[type].includes(id) ? prev[type].filter(x => x !== id) : [...prev[type], id] }))
    },
    isFav(type, id) {
      return favs[type].includes(id)
    },
    favGroups: favmeta.groups,
    favGroupOf(itemId) {
      return favmeta.of[itemId] ?? ''
    },
    addFavGroup(name) {
      const n = name.trim()
      if (!n) return '给分组起个名字吧'
      if (n.length > 6) return '分组名至多 6 个字'
      if (favmeta.groups.includes(n)) return '已有同名分组'
      if (favmeta.groups.length >= 6) return '至多 6 个分组'
      setFavmeta(p => ({ ...p, groups: [...p.groups, n] }))
      return null
    },
    removeFavGroup(name) {
      setFavmeta(p => {
        const of: Record<string, string> = {}
        for (const [k, v] of Object.entries(p.of)) if (v !== name) of[k] = v
        return { groups: p.groups.filter(g => g !== name), of }
      })
    },
    renameFavGroup(oldName, newName) {
      const n = newName.trim()
      if (!n) return '给分组起个名字吧'
      if (n.length > 6) return '分组名至多 6 个字'
      if (n === oldName) return null
      if (favmeta.groups.includes(n)) return '已有同名分组'
      setFavmeta(p => {
        const of: Record<string, string> = {}
        for (const [k, v] of Object.entries(p.of)) of[k] = v === oldName ? n : v
        return { groups: p.groups.map(g => (g === oldName ? n : g)), of }
      })
      return null
    },
    setFavGroup(itemId, group) {
      setFavmeta(p => {
        const of = { ...p.of }
        if (group) of[itemId] = group
        else delete of[itemId]
        return { ...p, of }
      })
    },
    composerDraft,
    setComposerDraft(text) {
      setComposerDraftState(text)
    },
    recallMsg(otherId, msgId) {
      if (!me) return
      const key = [me.id, otherId].sort().join(':')
      setMatch(prev => ({
        ...prev,
        chats: {
          ...prev.chats,
          [key]: (prev.chats[key] ?? []).map(m => (m.id === msgId && m.from === me.id ? { ...m, recalled: true } : m)),
        },
      }))
    },
    addEventComment(eventId, text) {
      if (!me || !text.trim()) return
      const c: PostComment = { id: `ec${Date.now().toString(36)}`, authorId: me.id, text: text.trim(), at: Date.now() }
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, comments: [...(e.comments ?? []), c] } : e)))
    },
    toggleEventCommentLike(eventId, commentId) {
      if (!me) return
      setEvents(prev =>
        prev.map(e =>
          e.id !== eventId
            ? e
            : {
                ...e,
                comments: (e.comments ?? []).map(c =>
                  c.id === commentId
                    ? { ...c, likes: (c.likes ?? []).includes(me.id) ? (c.likes ?? []).filter(x => x !== me.id) : [...(c.likes ?? []), me.id] }
                    : c,
                ),
              },
        ),
      )
    },
    toggleEventCommentPin(eventId, commentId) {
      if (!me) return false
      const ev = events.find(e => e.id === eventId)
      if (!ev || (ev.creatorId !== me.id && me.role !== 'admin')) return false
      setEvents(prev =>
        prev.map(e =>
          e.id !== eventId ? e : { ...e, comments: (e.comments ?? []).map(c => (c.id === commentId ? { ...c, pinned: !c.pinned } : c)) },
        ),
      )
      return true
    },
    deleteEventComment(eventId, commentId) {
      if (!me) return false
      const ev = events.find(e => e.id === eventId)
      const c = ev?.comments?.find(x => x.id === commentId)
      if (!ev || !c || (c.authorId !== me.id && ev.creatorId !== me.id && me.role !== 'admin')) return false
      // 掌柜代删他人留言时留痕
      if (me.role === 'admin' && c.authorId !== me.id) logOp(`删除活动评论:${c.text.slice(0, 12)}`)
      setEvents(prev =>
        prev.map(e => (e.id === eventId ? { ...e, comments: (e.comments ?? []).filter(x => x.id !== commentId) } : e)),
      )
      return true
    },
    recordVisit(viewedId) {
      if (!me || viewedId === me.id || me.stealth) return
      setVisits(prev => {
        const list = (prev[viewedId] ?? []).filter(v => v.id !== me.id)
        return { ...prev, [viewedId]: [{ id: me.id, at: Date.now() }, ...list].slice(0, 50) }
      })
    },
    visitorsOf(uid) {
      return (visits[uid] ?? [])
        .map(v => ({ user: users.find(u => u.id === v.id), at: v.at }))
        .filter((x): x is { user: User; at: number } => !!x.user)
    },
    blocks,
    isBlocked(uid) {
      return blocks.includes(uid)
    },
    toggleBlock(uid) {
      setBlocks(prev => (prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]))
    },
    reportUser(uid, reason, note) {
      if (!me) return
      setReports(prev => [{ id: `rp${Date.now().toString(36)}`, by: me.id, target: uid, reason, note, at: Date.now() }, ...prev])
    },
    resolveReport(reportId, action) {
      if (me?.role !== 'admin') return false
      const rec = reports.find(r => r.id === reportId)
      const target = rec?.target
      logOp(action === 'ban' ? '处理举报:停用了被举报账号' : '处理举报:忽略了该举报')
      setReports(prev => prev.map(r => (r.id === reportId ? { ...r, status: 'done' } : r)))
      if (action === 'ban' && target) {
        setUsers(prev => prev.map(u => (u.id === target ? { ...u, banned: true } : u)))
      }
      // 处理结果回音给举报人
      if (rec?.by && rec.by !== me.id) {
        const key = [me.id, rec.by].sort().join(':')
        const note =
          action === 'ban'
            ? '你提交的举报已核实,相关账号已停用。感谢你守护社区清气。'
            : '你提交的举报已核查,我们会持续关注该会员的言行。感谢你的反馈。'
        setMatch(prev => ({
          ...prev,
          chats: {
            ...prev.chats,
            [key]: [...(prev.chats[key] ?? []), { id: `nt${Date.now().toString(36)}`, from: me.id, text: note, at: Date.now() }],
          },
        }))
      }
      return true
    },
    unbanUser(uid) {
      if (me?.role !== 'admin') return false
      logOp(`恢复账号:${users.find(u => u.id === uid)?.nickname ?? uid}`)
      setUsers(prev => prev.map(u => (u.id === uid ? { ...u, banned: false } : u)))
      return true
    },
    banUser(uid) {
      if (me?.role !== 'admin') return false
      const t = users.find(u => u.id === uid)
      if (!t || t.role === 'admin') return false
      logOp(`停用账号:${t.nickname}`)
      setUsers(prev => prev.map(u => (u.id === uid ? { ...u, banned: true } : u)))
      return true
    },
    async resetMemberPassword(uid) {
      if (me?.role !== 'admin') return null
      const t = users.find(u => u.id === uid)
      try {
        const temp = await adminResetPassword(uid)
        // 运营日志只记事件不记明文;明文临时密码仅在界面展示一次
        logOp(`重置会员密码:${t?.nickname ?? uid}(临时密码仅展示一次)`)
        return temp
      } catch {
        toast.error('重置未成功,请稍后再试')
        return null
      }
    },
    adminSetUserPhoto(uid, dataUrl) {
      if (me?.role !== 'admin') return false
      const t = users.find(u => u.id === uid)
      if (!t) return false
      logOp(`更换头像:${t.nickname}`)
      setUsers(prev => prev.map(u => (u.id === uid ? { ...u, photos: [dataUrl, ...u.photos.slice(1)] } : u)))
      return true
    },
    adminSetEventCover(eventId, dataUrl) {
      if (me?.role !== 'admin') return false
      const t = events.find(e => e.id === eventId)
      if (!t) return false
      logOp(`更换活动封面:${t.title}`)
      setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, cover: dataUrl } : e)))
      return true
    },
    adminSetPostImages(postId, images) {
      if (me?.role !== 'admin') return false
      const t = posts.find(p => p.id === postId)
      if (!t) return false
      logOp(`维护帖子图片:${t.text.slice(0, 12)}`)
      setPosts(prev => prev.map(p => (p.id === postId ? { ...p, images } : p)))
      return true
    },
    purgeChatImages() {
      if (me?.role !== 'admin') return 0
      let n = 0
      const chats: Record<string, ChatMsg[]> = {}
      for (const [k, msgs] of Object.entries(match.chats)) {
        chats[k] = msgs.map(m => {
          if (m.images?.length || m.image) {
            n += (m.images?.length ?? 0) + (m.image ? 1 : 0)
            return { ...m, image: undefined, images: undefined }
          }
          return m
        })
      }
      if (!n) return 0
      logOp(`清理聊天图片 ${n} 张`)
      setMatch(prev => ({ ...prev, chats }))
      return n
    },
    tour,
    markTour(key) {
      setTour(prev => (prev[key] ? prev : { ...prev, [key]: true }))
    },
    icebreakerFor(other) {
      if (!me) return '你好,幸会。'
      const shared = me.interests.filter(t => other.interests.includes(t))
      const pool = shared.length
        ? [
            `你好,我是${me.nickname}。看到你也喜欢「${shared[0]}」,忍不住来打个招呼。`,
            `幸会。说来有缘,「${shared[0]}」也是我生活里很重要的一部分,改日交流?`,
            `你好呀,系统说我们在「${shared[0]}」上很有共鸣,我来验证一下。`,
          ]
        : [
            `你好,我是${me.nickname}。你的自述我读了两遍,很真诚,所以来了。`,
            `幸会。缘分把我推到你面前,剩下的交给我自己开口。`,
          ]
      return pool[hashStr(me.id + other.id) % pool.length]
    },
    candidates() {
      if (!me) return []
      const passed = match.passes[me.id] ?? []
      return users.filter(u => u.id !== me.id && !u.role && !u.banned && u.gender === me.seeking && !passed.includes(u.id) && !blocks.includes(u.id))
    },
    dailyYuanfen() {
      if (!me) return []
      const today = new Date().toISOString().slice(0, 10)
      const pool = store.candidates()
      const seed = hashStr(me.id + today)
      const sorted = [...pool].sort((a, b) => hashStr(a.id + seed) - hashStr(b.id + seed))
      return sorted.slice(0, 3)
    },
    matchScore(other) {
      if (!me) return 0
      const p = store.matchParts(other)
      const s = 50 + p.sharedPts + p.agePts + p.cityPts + p.districtPts + p.verifyPts
      return Math.max(50, Math.min(99, s))
    },
    settings,
    saveSettings(patch) {
      if (me?.role !== 'admin') return false
      logOp('保存了站点设置(功能开关 / 活动展示 / 公告 / 佳音墙)')
      setSettings(prev => ({
        ...prev,
        ...patch,
        features: { ...prev.features, ...(patch.features ?? {}) },
      }))
      return true
    },
    featureOn(k) {
      return settings.features[k] !== false
    },
    toggleEventHidden(eventId) {
      if (me?.role !== 'admin') return false
      const was = settings.hiddenEvents.includes(eventId)
      logOp(`${was ? '恢复展示活动' : '隐藏了活动'}:${events.find(e => e.id === eventId)?.title ?? eventId}`)
      setSettings(prev => ({
        ...prev,
        hiddenEvents: prev.hiddenEvents.includes(eventId)
          ? prev.hiddenEvents.filter(x => x !== eventId)
          : [...prev.hiddenEvents, eventId],
      }))
      return true
    },
  }

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}

/** 读取图片并压缩; v1.8 起优先上传落盘换 URL(数据库不再存大体积 dataURL), 失败回退内联 */
export function readImageFile(file: File, max = 900): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read fail'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('canvas fail'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = () => reject(new Error('img fail'))
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }).then(async dataUrl => {
    try {
      return await uploadImage(dataUrl)
    } catch {
      return dataUrl
    }
  })
}
