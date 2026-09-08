import { Award, BadgeCheck, Bookmark, CalendarCheck, Camera, CalendarClock, CalendarHeart, CalendarRange, Crown, Eye, Footprints, Heart, HeartHandshake, HeartPulse, ImagePlus, Images, Medal, MessagesSquare, Milestone, PartyPopper, PenLine, Sparkles, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { completeness, useStore } from '@/lib/store'
import type { User } from '@/lib/store'

export interface BadgeDef {
  id: string
  name: string
  desc: string
  icon: LucideIcon
  cur: number
  target: number
  /** 缘阶: 同名进阶梯上的位次, 如「心动 · 二阶」 */
  stage?: string
}

export function buildBadges(me: User, s: ReturnType<typeof useStore>): BadgeDef[] {
  const { events, posts, favs, likesOf, mutuals, conversations, visitorsOf, checkins, tour } = s
  const photoCount = me.photos.length
  const liked = likesOf(me.id).length
  const joined = events.filter(e => e.attendees.includes(me.id)).length
  const checkinCount = (checkins[me.id] ?? []).length
  const myPosts = posts.filter(p => p.authorId === me.id).length
  const chatted = conversations().filter(c => c.lastText).length
  const profilePct = completeness(me).pct
  const verifiedCount = Object.values(me.verification).filter(Boolean).length

  const riteCount = [
    profilePct >= 60,
    photoCount >= 2,
    verifiedCount >= 1,
    !!tour.yuanfen,
    conversations().length > 0,
    favs.users.length + favs.posts.length + favs.events.length > 0,
    joined >= 1,
    !!tour.digest,
    myPosts >= 1,
    checkinCount >= 1,
  ].filter(Boolean).length

  return [
    { id: 'begin', name: '缘起', desc: '在随缘网落下第一笔', icon: Sparkles, cur: 1, target: 1 },
    { id: 'photo3', name: '有图有真相', desc: '上传 3 张生活照', icon: Camera, cur: photoCount, target: 3, stage: '影集 · 一阶' },
    { id: 'photo6', name: '满园春色', desc: '集齐 6 张照片', icon: Images, cur: photoCount, target: 6, stage: '影集 · 二阶' },
    { id: 'photo9', name: '影集盈匣', desc: '集齐 9 张照片', icon: ImagePlus, cur: photoCount, target: 9, stage: '影集 · 三阶' },
    { id: 'verify', name: '真实可鉴', desc: '通过全部三重验证', icon: BadgeCheck, cur: verifiedCount, target: 3 },
    { id: 'profile', name: '资料圆满', desc: '资料完善度达到 100%', icon: Award, cur: profilePct, target: 100 },
    { id: 'like1', name: '初见心动', desc: '向 1 位有缘人道「有意」', icon: Heart, cur: liked, target: 1, stage: '心动 · 一阶' },
    { id: 'like5', name: '广结善缘', desc: '向 5 位有缘人道「有意」', icon: HeartHandshake, cur: liked, target: 5, stage: '心动 · 二阶' },
    { id: 'like10', name: '缘结十方', desc: '向 10 位有缘人道「有意」', icon: HeartPulse, cur: liked, target: 10, stage: '心动 · 三阶' },
    { id: 'mutual', name: '互道有意', desc: '与 1 位有缘人双向心动', icon: Trophy, cur: mutuals().length, target: 1 },
    { id: 'chat3', name: '佳音频传', desc: '与 3 位有缘人聊起来', icon: MessagesSquare, cur: chatted, target: 3, stage: '佳音 · 一阶' },
    { id: 'chat6', name: '谈笑风生', desc: '与 6 位有缘人聊起来', icon: PartyPopper, cur: chatted, target: 6, stage: '佳音 · 二阶' },
    { id: 'fav1', name: '收藏心动', desc: '收藏 1 位有缘人', icon: Bookmark, cur: favs.users.length, target: 1 },
    { id: 'event1', name: '赴约之人', desc: '报名 1 场线下活动', icon: CalendarClock, cur: joined, target: 1, stage: '赴约 · 一阶' },
    { id: 'event3', name: '常客之约', desc: '报名 3 场线下活动', icon: CalendarHeart, cur: joined, target: 3, stage: '赴约 · 二阶' },
    { id: 'event5', name: '五度赴约', desc: '报名 5 场线下活动', icon: CalendarRange, cur: joined, target: 5, stage: '赴约 · 三阶' },
    { id: 'checkin1', name: '如约而至', desc: '完成 1 次活动到场打卡', icon: CalendarCheck, cur: checkinCount, target: 1, stage: '如约 · 一阶' },
    { id: 'checkin3', name: '三约不弃', desc: '完成 3 次活动到场打卡', icon: Footprints, cur: checkinCount, target: 3, stage: '如约 · 二阶' },
    { id: 'checkin5', name: '五度如约', desc: '完成 5 次活动到场打卡', icon: Milestone, cur: checkinCount, target: 5, stage: '如约 · 三阶' },
    { id: 'post1', name: '社区之声', desc: '在社区发布 1 条分享', icon: PenLine, cur: myPosts, target: 1 },
    { id: 'visit5', name: '众星捧月', desc: '迎来 5 位访客', icon: Eye, cur: visitorsOf(me.id).length, target: 5, stage: '人气 · 一阶' },
    { id: 'visit15', name: '门庭若市', desc: '迎来 15 位访客', icon: Crown, cur: visitorsOf(me.id).length, target: 15, stage: '人气 · 二阶' },
    { id: 'rite', name: '新人礼成', desc: '点亮「新人启程」清单全部十事', icon: Medal, cur: riteCount, target: 10 },
  ]
}

/** 缘阶: 按点亮成就数进阶 */
export const LEVEL_TIERS = [
  { name: '初识', min: 0 },
  { name: '结缘', min: 3 },
  { name: '知心', min: 6 },
  { name: '莫逆', min: 10 },
  { name: '天成', min: 15 },
]

export function yuanLevel(s: ReturnType<typeof useStore>, user: User) {
  const lit = buildBadges(user, s).filter(b => b.cur >= b.target).length
  let idx = 0
  LEVEL_TIERS.forEach((t, i) => {
    if (lit >= t.min) idx = i
  })
  const next = LEVEL_TIERS[idx + 1] ?? null
  return { idx, name: LEVEL_TIERS[idx].name, lit, next }
}
