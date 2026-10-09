import type { FeatureKey, Settings, User } from './store-types'

export const REPORT_REASONS = ['虚假资料或冒充他人', '言语骚扰或辱骂', '诈骗或索要钱财', '发布不当内容', '其他原因']

export const TOPICS = ['认识我', '兴趣见闻', '活动回顾', '想一起做']

export const TOPIC_GUIDE: Record<string, string> = {
  认识我: '写一个真实片段：你的习惯、选择、价值观，或最近让你有感触的一件事。',
  兴趣见闻: '不只说“我喜欢”，也说说你为什么喜欢、最近看见了什么，让同好更容易认识你。',
  活动回顾: '记录你真实参加过的活动、现场感受和遇见的人，不写虚构经历。',
  想一起做: '说清想一起做什么、城市/大致时间和期待的同行方式，不发布招聘、交易或导流信息。',
}

export const INTERESTS = ['诗词', '摄影', '旅行', '美食', '茶艺', '音乐', '书法', '电影', '登山', '烹饪', '围棋', '国风', '汉服', '瑜伽', '骑行', '看展', '桌游']

const RISK_WORDS = ['转账', '汇款', '投资', '理财', '返利', '刷单', '借钱', '验证码', '保证金', '解冻', '稳赚', '银行卡密码']
export const riskWord = (text: string) => RISK_WORDS.find(w => text.includes(w)) ?? null

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
  if (!birthDate) return 0
  const b = new Date(birthDate)
  if (Number.isNaN(b.getTime())) return 0
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--
  return a > 0 ? a : 0
}

export function isProfileReadyForMatching(u: User): boolean {
  return u.gender !== 'unknown' && u.seeking !== 'unknown' && !!u.birthDate && !!u.city && ageOf(u.birthDate) >= 18
}

export function daysUntil(date: string): number {
  const d = new Date(`${date}T00:00:00`)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((d.getTime() - today.getTime()) / 86400_000)
}

export function completeness(u: User): { pct: number; tips: Array<{ text: string; pts: number; to?: string }> } {
  const tips: Array<{ text: string; pts: number; to?: string }> = []
  let score = 0

  const basics = [u.gender !== 'unknown', u.seeking !== 'unknown', ageOf(u.birthDate) >= 18, !!u.city]
  const basePts = Math.round((basics.filter(Boolean).length / basics.length) * 35)
  score += basePts
  if (basePts < 35) tips.push({ text: '确认性别、期待认识对象、出生日期和所在城市后才进入推荐池', pts: 35 - basePts, to: '/me' })

  const n = u.photos.length
  const pPts = n >= 3 ? 20 : n === 2 ? 14 : n === 1 ? 8 : 0
  score += pPts
  if (pPts < 20) tips.push({ text: n === 0 ? '上传照片,让有缘人先看见你' : '再补几张照片(3 张以上),印象更立体', pts: 20 - pPts })

  const bio = u.bio.trim()
  const bPts = !bio ? 0 : bio.length >= 30 ? 20 : bio.length >= 10 ? 12 : 6
  score += bPts
  if (bPts < 20) tips.push({ text: !bio ? '写一段真实的自我介绍,30 字以上更佳' : '自我介绍再丰富些', pts: 20 - bPts })

  const iPts = u.interests.length >= 5 ? 15 : u.interests.length >= 3 ? 8 : 0
  score += iPts
  if (iPts < 15) tips.push({ text: '多勾选几个兴趣爱好,让同好更容易找到你', pts: 15 - iPts })

  const jPts = u.job.trim() ? 10 : 0
  score += jPts
  if (jPts < 10) tips.push({ text: '愿意的话填写职业信息,聊天更好开口', pts: 10 - jPts })

  return { pct: Math.min(100, score), tips }
}

export function weekNo(): number {
  const d = new Date()
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - start.getTime()) / 86400_000 + start.getDay() + 1) / 7)
}
