import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarHeart, CheckCircle2, ChevronDown, Circle, Compass } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { isProfileReadyForMatching } from '@/lib/store-model'
import { cn } from '@/lib/utils'

const D = 86400_000
const FOLD_KEY = 'sy_taskboard_fold'

const readFold = (): { rite?: boolean; week?: boolean } => {
  try {
    const raw = localStorage.getItem(FOLD_KEY)
    if (raw) return JSON.parse(raw) as { rite?: boolean; week?: boolean }
  } catch {
    /* 读不到就当没存过 */
  }
  return {}
}

export function TaskBoard() {
  const { me, tour, likesOf, activityStats, users, chatWith, visits } = useStore()
  const [riteOpen, setRiteOpen] = useState(() => readFold().rite ?? true)
  const [weekOpen, setWeekOpen] = useState(() => readFold().week ?? true)
  const foldRite = (v: boolean) => {
    setRiteOpen(v)
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFold(), rite: v }))
    } catch {
      /* 存不上就算了 */
    }
  }
  const foldWeek = (v: boolean) => {
    setWeekOpen(v)
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFold(), week: v }))
    } catch {
      /* 存不上就算了 */
    }
  }
  if (!me) return null

  const tasks = [
    { done: isProfileReadyForMatching(me), text: '确认必要真实资料', desc: '性别、希望认识的对象、出生日期与城市都由本人确认', to: '/me#profile-editor' },
    { done: !!tour.yuanfen, text: '看过一次今日推荐', desc: '先理解推荐理由，再判断是否适合进一步了解', to: '/yuanfen' },
    { done: likesOf(me.id).length > 0, text: '本人确认并表达一次「有意」', desc: '不替你自动开口；每一次有意都来自你的真实选择', to: '/yuanfen' },
  ]
  const done = tasks.filter(t => t.done).length

  // 本周缘事: 每周一归零重刷, 只算本周内的动作
  const now = new Date()
  const dow = (now.getDay() + 6) % 7 // 周一为一周之始
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime()
  const weekNo = Math.ceil(((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / D + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7)
  let sentThisWeek = 0
  for (const u of users) {
    for (const m of chatWith(u.id)) {
      if (m.from === me.id && m.at >= weekStart) sentThisWeek++
    }
  }
  const visitedOut = Object.values(visits).some(list => list.some(v => v.id === me.id && v.at >= weekStart))
  const commented = activityStats.lastCommentAt >= weekStart
  const weekly = [
    { done: sentThisWeek > 0, text: '送出一声招呼', desc: '开口,就是缘起', to: '/matches' },
    { done: visitedOut, text: '回访一位有缘人', desc: '回望的目光,最动人', to: '/explore' },
    { done: commented, text: '留下一句回帖', desc: '在别人的故事里留个声', to: '/community' },
  ]
  const weeklyDone = weekly.filter(t => t.done).length

  const renderTask = (t: { done: boolean; text: string; desc: string; to?: string }) => {
    const inner = (
      <div className="flex items-start gap-2.5">
        {t.done ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 animate-seal-stamp text-gold" />
        ) : (
          <Circle size={16} className="mt-0.5 shrink-0 text-border" />
        )}
        <div className="min-w-0">
          <p className={cn('text-sm', t.done ? 'text-muted-foreground line-through decoration-border' : 'text-foreground/85')}>{t.text}</p>
          <p className="text-[11px] text-muted-foreground">{t.desc}</p>
        </div>
        {!t.done && t.to && <span className="ml-auto mt-0.5 shrink-0 text-[11px] text-primary">去完成 →</span>}
      </div>
    )
    return (
      <li key={t.text}>
        {t.to && !t.done ? (
          <Link to={t.to} className="block rounded-md border border-border bg-secondary/30 p-2.5 transition hover:border-primary/40">{inner}</Link>
        ) : (
          <div className="rounded-md border border-transparent p-2.5">{inner}</div>
        )}
      </li>
    )
  }

  return (
    <>
      <section className="card-cn rounded-lg p-5 md:p-6">
        <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => foldRite(!riteOpen)} aria-expanded={riteOpen}>
          <Compass size={18} className="shrink-0 text-gold" />
          <span className="font-xing text-2xl text-foreground">新人启程</span>
          <span className="cjk-latin ml-auto text-sm text-muted-foreground">{done}/{tasks.length}</span>
          <ChevronDown size={16} className={cn('shrink-0 text-muted-foreground transition-transform', !riteOpen && '-rotate-90')} />
        </button>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-gradient-to-r from-gold to-primary transition-all duration-500" style={{ width: `${(done / tasks.length) * 100}%` }} />
        </div>
        {riteOpen &&
          (done === tasks.length ? (
            <>
              <p className="mt-4 rounded-md bg-gold/10 p-4 text-center text-sm text-gold">
                三步已完成。接下来不必刷任务，只管按自己的节奏认真认识人。
              </p>
              <Link to="/badges" className="mt-2 block text-center text-xs text-primary transition hover:text-primary/80">
                「新人礼成」勋章已点亮,去看看 →
              </Link>
            </>
          ) : (
            <ul className="mt-4 space-y-2">{tasks.map(renderTask)}</ul>
          ))}
      </section>

      <section className="card-cn mt-4 rounded-lg p-5 md:p-6">
        <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => foldWeek(!weekOpen)} aria-expanded={weekOpen}>
          <CalendarHeart size={18} className="shrink-0 text-gold" />
          <span className="font-xing text-2xl text-foreground">本周缘事</span>
          <span className="cjk-latin ml-auto text-sm text-muted-foreground">{weeklyDone}/{weekly.length}</span>
          <ChevronDown size={16} className={cn('shrink-0 text-muted-foreground transition-transform', !weekOpen && '-rotate-90')} />
        </button>
        {weekOpen && (
          <>
            <p className="cjk-latin mt-1 text-[11px] text-muted-foreground">第 {weekNo} 周 · 每周一更新，按自己的节奏完成</p>
            <ul className="mt-3 space-y-2">{weekly.map(renderTask)}</ul>
          </>
        )}
      </section>
    </>
  )
}
