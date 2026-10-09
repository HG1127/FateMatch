import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, BookHeart, CalendarClock, CheckCircle2, Circle, Eye, HeartHandshake, MessagesSquare, Send, Share2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import { yuanLevel } from '@/lib/badges'
import { LevelSeal, NickName } from '@/components/ui'
import { cn } from '@/lib/utils'
import { completeness, hashStr } from '@/lib/store-model'
import type { WeeklyActivity } from '@/lib/store-types'

const D = 86400_000

export function ReportPage() {
  const store = useStore()
  const { me, users, mutuals, likesOf, favs, upcomingReminded, matchScore, isMutual, digests, activityStats, loadWeeklyActivity, loadCommunityDigests } = store
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const since = todayStart - 6 * D // 最近 7 个自然日
  const [weekly, setWeekly] = useState<WeeklyActivity>({ visits: [], messages: [] })
  const [weeklyLoading, setWeeklyLoading] = useState(true)
  const [weeklyError, setWeeklyError] = useState('')
  const [weeklyRetry, setWeeklyRetry] = useState(0)
  const loadWeeklyRef = useRef(loadWeeklyActivity)
  const loadDigestsRef = useRef(loadCommunityDigests)
  useEffect(() => { loadWeeklyRef.current = loadWeeklyActivity }, [loadWeeklyActivity])
  useEffect(() => { loadDigestsRef.current = loadCommunityDigests }, [loadCommunityDigests])
  const meId = me?.id ?? ''
  useEffect(() => {
    if (!meId) return
    let alive = true
    void Promise.resolve().then(async () => {
      if (!alive) return
      setWeeklyLoading(true)
      setWeeklyError('')
      try {
        const data = await loadWeeklyRef.current(since)
        if (alive) setWeekly(data)
        void loadDigestsRef.current().catch(() => {})
      } catch (e) {
        if (alive) setWeeklyError(e instanceof Error ? e.message : '周报数据加载失败')
      } finally {
        if (alive) setWeeklyLoading(false)
      }
    })
    return () => { alive = false }
  }, [meId, since, weeklyRetry])

  if (!me) return null
  const lv = yuanLevel(store, me)

  // 每日坐标轴(旧 → 新)
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = todayStart - (6 - i) * D
    const d = new Date(start)
    return { start, label: `${d.getMonth() + 1}/${d.getDate()}`, visits: 0, msgs: 0 }
  })
  const dayIdx = (at: number) => {
    const i = Math.floor((at - days[0].start) / D)
    return i >= 0 && i < 7 ? i : -1
  }

  // 访客：直接来自服务端最近 7 天轻量事件，不依赖登录首包 visits。
  const weekVisits = weekly.visits
    .filter(v => v.viewedId === me.id)
    .map(v => ({ user: users.find(u => u.id === v.viewerId), at: v.at }))
    .filter((v): v is { user: NonNullable<typeof v.user>; at: number } => !!v.user)
  const weekPartners = new Set<string>()
  weekVisits.forEach(v => {
    weekPartners.add(v.user.id)
    const i = dayIdx(v.at)
    if (i >= 0) days[i].visits++
  })

  // 互访：同一周内双方都真实访问过对方主页。
  const myOut = new Set(weekly.visits.filter(v => v.viewerId === me.id).map(v => v.viewedId))
  const mutualPartners = [...new Map(weekVisits.filter(v => myOut.has(v.user.id)).map(v => [v.user.id, v.user])).values()]
  const weekDigests = digests.filter(d => d.at >= since)

  // 往来消息：只取时间/方向，不读取正文或图片，避免聊天懒加载后漏算。
  let sent = 0
  let received = 0
  for (const m of weekly.messages) {
    weekPartners.add(m.otherId)
    if (m.direction === 'sent') sent++
    else received++
    const i = dayIdx(m.at)
    if (i >= 0) days[i].msgs++
  }

  const mutual = mutuals().length
  const liked = likesOf(me.id).length
  // 本周缘事三件: 与任务板同口径, 只算最近 7 天
  const weekTasks = [
    { done: sent > 0, text: '送出一声招呼' },
    { done: myOut.size > 0, text: '回访一位有缘人' },
    { done: activityStats.lastCommentAt >= since, text: '留下一句回帖' },
  ]
  const weekTasksDone = weekTasks.filter(t => t.done).length
  const favTotal = favs.users.length + favs.posts.length + favs.events.length
  const pct = completeness(me).pct
  const reminded = upcomingReminded()
  const maxBar = Math.max(1, ...days.map(d => d.visits + d.msgs))

  const weekNo = Math.ceil(((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / D + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7)
  const rangeStr = `${new Date(since).getMonth() + 1} 月 ${new Date(since).getDate()} 日 — ${now.getMonth() + 1} 月 ${now.getDate()} 日`

  // 本周寄语:按数据挑一句
  const summary = (() => {
    if (mutualPartners.length > 0) return `本周你与 ${mutualPartners.length} 位有缘人互访了主页——回望过的目光,就是故事的开头。`
    if (mutual > 0 && received > 0) return '有来有往,佳音渐响。这一周的缘分,已经开始生根。'
    if (weekVisits.length >= 3) return `${weekVisits.length} 位有缘人路过了你的主页——缘在门外张望,只差你一次主动。`
    if (sent > 0) return '你送出的每一声招呼,都是在给缘分铺路。继续开口,回音在路上。'
    if (liked > 0) return `${liked} 份「有意」正悄悄向你靠拢,多回一次访客,也许就是缘起。`
    return '这一周缘分尚在蓄势。完善资料、逛一逛今日随缘,让缘有处可寻。'
  })()

  const hash = hashStr(me.id)
  const advicePool = [
    { text: '回访一位看过你的有缘人,礼尚往来最是动人', to: '/me', show: weekVisits.length > 0 },
    { text: '把聊得来的那位收藏起来,心动值得存档', to: '/favorites', show: sent + received > 0 },
    { text: '去社区发一篇分享,让别人先看见你的生活', to: '/community', show: true },
    { text: '报名一场线下活动,缘分也讲见面三分情', to: '/events', show: true },
    { text: '再补几张照片或自我介绍,完善度还差一口气', to: '/me', show: pct < 100 },
  ].filter(a => a.show)
  const advice = advicePool.length ? advicePool[hash % advicePool.length] : advicePool[0]

  const stats = [
    { icon: Eye, label: '访客来访', value: weekVisits.length, sub: '最近 7 天', cls: 'text-primary' },
    { icon: Send, label: '送出招呼', value: sent, sub: '我发出的消息', cls: 'text-primary' },
    { icon: MessagesSquare, label: '收到回音', value: received, sub: '对方发来的消息', cls: 'text-gold' },
    { icon: HeartHandshake, label: '互道有意', value: mutual, sub: `累计被有意 ${liked} 次`, cls: 'text-primary' },
    { icon: Bookmark, label: '收藏心动', value: favTotal, sub: '佳人·帖文·活动', cls: 'text-gold' },
    { icon: Sparkles, label: '资料完善', value: `${pct}%`, sub: pct >= 100 ? '已圆满' : '仍有提升空间', cls: 'text-primary' },
  ]

  // 本周互动对象里契合度最高的一位
  const topMatch = (() => {
    const arr = [...weekPartners].map(id => users.find(u => u.id === id)).filter(Boolean)
    if (!arr.length) return null
    return [...arr].sort((a, b) => matchScore(b!) - matchScore(a!))[0]
  })()

  if (weeklyLoading) {
    return <div className="clouds-paper mx-auto max-w-4xl px-4 py-20 text-center text-sm text-muted-foreground">正在汇总最近 7 天的真实互动记录…</div>
  }
  if (weeklyError) {
    return (
      <div className="clouds-paper mx-auto max-w-4xl px-4 py-20 text-center">
        <p className="text-sm text-muted-foreground">{weeklyError}</p>
        <button className="btn-primary mt-4" onClick={() => setWeeklyRetry(v => v + 1)}>重新加载周报</button>
      </div>
    )
  }

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">缘分周报</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">
          <span className="cjk-latin">第 {weekNo} 周</span> · 缘事小结
        </h1>
        <p className="cjk-latin mt-2 text-sm text-muted-foreground">{rangeStr} · 你的每一份心意,都被记着</p>
        <p className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          当前缘阶
          <LevelSeal user={me} />
          {lv.next ? (
            <>
              已点亮 <span className="cjk-latin">{lv.lit}</span> 枚成就 · 再 <span className="cjk-latin">{lv.next.min - lv.lit}</span> 枚至「{lv.next.name}」
            </>
          ) : (
            '已至最高阶'
          )}
        </p>
        <button
          className="btn-outline mx-auto mt-4 flex !px-4 !py-2 text-xs"
          onClick={() => {
            const lines = [
              `随缘网 · 第 ${weekNo} 周缘事小结`,
              `${rangeStr}`,
              `当前缘阶 ${lv.name} · 已点亮 ${lv.lit} 枚成就`,
              `访客 ${weekVisits.length} · 送出招呼 ${sent} · 收到回音 ${received} · 互道有意 ${mutual} · 互访 ${mutualPartners.length} · 本周缘事 ${weekTasksDone}/3`,
              `本周寄语:${summary}`,
              '—— 随缘网 · 一切相遇皆是缘',
            ]
            navigator.clipboard
              ?.writeText(lines.join('\n'))
              .then(() => toast.success('周报已复制,去分享你的缘吧'))
              .catch(() => toast.error('复制失败,请截图分享'))
          }}
        >
          <Share2 size={13} />
          复制周报分享
        </button>
      </div>

      {/* 本周寄语 */}
      <section className="card-cn relative mb-8 overflow-hidden rounded-lg p-6 md:p-8">
        <div className="lattice absolute inset-x-0 top-0" />
        <p className="flex items-center gap-2 text-xs tracking-[.3em] text-gold">
          <BookHeart size={14} />
          本周寄语
        </p>
        <p className="mt-3 font-xing text-2xl leading-relaxed text-foreground md:text-3xl">{summary}</p>
        <p className="mt-3 text-xs text-muted-foreground">—— 随缘网 · 为 <NickName user={me} /> 执笔</p>
      </section>

      {/* 数据六格 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map(s => (
          <div key={s.label} className="card-cn rounded-lg p-4 text-center">
            <s.icon size={18} className={cn('mx-auto', s.cls)} />
            <p className={cn('cjk-latin mt-2 font-xing text-3xl', s.cls)}>{s.value}</p>
            <p className="mt-1 text-sm text-foreground">{s.label}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* 本周互访 */}
      {mutualPartners.length > 0 && (
        <section className="card-cn mt-6 rounded-lg p-4 md:p-5">
          <p className="text-xs tracking-[.3em] text-gold">本周互访 · <span className="cjk-latin">{mutualPartners.length}</span> 人</p>
          <p className="mt-1 text-[11px] text-muted-foreground">你看过 TA 的主页,TA 也来过你的——彼此回望,只欠一人先开口。</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {mutualPartners.map(u => (
              <span key={u.id} className="flex items-center gap-2 rounded-full border border-gold/40 bg-gold/5 py-1 pl-1 pr-1.5 text-xs text-foreground">
                <img src={u.photos[0]} alt="" className="h-6 w-6 rounded-full object-cover" />
                {u.nickname}
                {isMutual(u.id) ? (
                  <Link
                    to={`/matches?with=${u.id}`}
                    className="ml-0.5 rounded-full border border-primary/40 px-2 py-0.5 text-[10px] text-primary transition hover:bg-primary hover:text-primary-foreground"
                  >
                    去佳音
                  </Link>
                ) : (
                  <span className="ml-0.5 text-[10px] text-muted-foreground">互道有意后可聊</span>
                )}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 本周精选上刊 */}
      {weekDigests.length > 0 && (
        <section className="card-cn mt-6 rounded-lg p-4 md:p-5">
          <p className="text-xs tracking-[.3em] text-gold">本周精选上刊 · <span className="cjk-latin">{weekDigests.length}</span> 期</p>
          <p className="mt-1 text-[11px] text-muted-foreground">掌柜把这一周最动人的分享编成了集,去社区门口翻阅。</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {weekDigests.map(d => (
              <Link
                key={d.id}
                to="/community"
                className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-foreground transition hover:border-primary/60"
              >
                <span className="seal flex h-5 w-5 items-center justify-center font-xing text-[10px]">{d.issue}</span>
                {d.title}
                <span className="cjk-latin text-[10px] text-muted-foreground">
                  {d.postIds.length} 篇
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 本周缘事 */}
      <section className="card-cn mt-6 rounded-lg p-4 md:p-5">
        <p className="text-xs tracking-[.3em] text-gold">本周缘事 · <span className="cjk-latin">{weekTasksDone}/{weekTasks.length}</span></p>
        <p className="mt-1 text-[11px] text-muted-foreground">三件小事,每周归零重刷——缘不嫌多。</p>
        <ul className="mt-2.5 space-y-1.5">
          {weekTasks.map(t => (
            <li key={t.text} className="flex items-center gap-2 text-xs">
              {t.done ? (
                <CheckCircle2 size={14} className="shrink-0 text-gold" />
              ) : (
                <Circle size={14} className="shrink-0 text-border" />
              )}
              <span className={t.done ? 'text-muted-foreground line-through decoration-border' : 'text-foreground/85'}>{t.text}</span>
            </li>
          ))}
        </ul>
        {weekTasksDone < weekTasks.length && (
          <Link to="/me" className="mt-2.5 inline-block text-xs text-primary transition hover:text-primary/80">去任务板补上一件 →</Link>
        )}
      </section>

      {/* 本周最契合 */}
      {topMatch && (
        <section className="card-cn mt-8 flex items-center gap-4 rounded-lg !border-gold/40 p-4">
          <img src={topMatch.photos[0]} alt={topMatch.nickname} className="h-14 w-14 shrink-0 rounded-full border-2 border-gold/60 object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-xs tracking-[.3em] text-gold">本周最契合</p>
            <p className="mt-1 text-sm text-foreground">
              <NickName user={topMatch} className="font-xing text-lg" />
              <span className="cjk-latin ml-2 text-gold">{matchScore(topMatch)}% 契合</span>
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">本周与你互动过的有缘人里,你们最合拍</p>
          </div>
          <Link to="/explore" className="btn-outline shrink-0 !px-4 !py-2 text-xs">去看看</Link>
        </section>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* 七日轨迹 */}
        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="flex items-center gap-2 font-xing text-2xl text-foreground">
            <CalendarClock size={18} className="text-gold" />
            七日缘分轨迹
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">红为往来消息,金为访客来访</p>
          <div className="mt-6 flex h-40 items-end gap-2 md:gap-3">
            {days.map(d => (
              <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                  <div className="w-2.5 rounded-t-sm bg-gold/70 transition-all" style={{ height: `${(d.visits / maxBar) * 100}%` }} title={`访客 ${d.visits}`} />
                  <div className="w-2.5 rounded-t-sm bg-primary transition-all" style={{ height: `${(d.msgs / maxBar) * 100}%` }} title={`消息 ${d.msgs}`} />
                </div>
                <span className="cjk-latin text-[10px] text-muted-foreground">{d.label}</span>
              </div>
            ))}
          </div>
          {weekVisits.length === 0 && sent + received === 0 && (
            <p className="mt-4 rounded-md bg-secondary/40 p-3 text-center text-xs text-muted-foreground">
              这一周还很安静,去随缘分配或兴趣匹配走一趟,轨迹就会亮起来。
            </p>
          )}
        </section>

        <div className="space-y-6">
          {/* 下周赴约 */}
          <section className="card-cn rounded-lg p-5">
            <h3 className="font-xing text-xl text-foreground">下周赴约</h3>
            {reminded.length ? (
              <ul className="mt-3 space-y-2">
                {reminded.slice(0, 3).map(({ event, days: d }) => (
                  <li key={event.id}>
                    <Link to="/events" className="block rounded-md border border-border bg-secondary/30 p-2.5 transition hover:border-gold/50">
                      <p className="truncate text-sm text-foreground">{event.title}</p>
                      <p className="cjk-latin mt-0.5 text-[11px] text-muted-foreground">
                        {event.city} · {d === 0 ? '今天' : d === 1 ? '明天' : `${d} 天后`} {event.time}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-md bg-secondary/40 p-3 text-xs text-muted-foreground">
                还没有设提醒的活动。去活动牵线挑一场,给下周留个念想。
              </p>
            )}
          </section>

          {/* 缘师小建议 */}
          <section className="card-cn rounded-lg p-5">
            <h3 className="flex items-center gap-1.5 font-xing text-xl text-foreground">
              <Sparkles size={15} className="text-gold" />
              缘师小建议
            </h3>
            {advice && (
              <Link to={advice.to} className="mt-3 block rounded-md border border-gold/40 bg-gold/10 p-3 text-sm leading-relaxed text-foreground transition hover:border-gold">
                {advice.text}
                <span className="mt-1.5 block text-xs text-primary">去做 →</span>
              </Link>
            )}
          </section>
        </div>
      </div>

      <p className="mt-10 text-center text-xs text-muted-foreground">
        每周一页,回看走过的缘 · 仅汇总你的站内互动记录，不向其他会员公开
      </p>
    </div>
  )
}
