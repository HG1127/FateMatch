import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarHeart, ChevronRight, Compass, MessageCircleHeart, UserRoundCheck } from 'lucide-react'
import { Hero } from '@/components/home/Hero'
import { Features } from '@/components/home/Features'
import { Stories } from '@/components/home/Stories'
import { Moments } from '@/components/home/Moments'
import { CtaBand } from '@/components/home/CtaBand'
import { PostTile } from '@/components/community/PostTile'
import { PostDialog } from '@/components/community/PostDialog'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { DigestBanner } from '@/components/community/DigestBanner'
import { DigestModal } from '@/components/community/DigestModal'
import { useStore } from '@/lib/store-context'
import type { Post, User } from '@/lib/store'
import { completeness, isProfileReadyForMatching } from '@/lib/store-model'

function Announcement() {
  const { settings } = useStore()
  const text = settings.announcement.trim()
  if (!text) return null
  return (
    <div className="border-b border-gold/25 bg-primary/5">
      <p className="mx-auto max-w-6xl px-4 py-2.5 text-center text-xs text-primary md:text-sm">
        <span className="seal mr-2 inline-flex h-5 w-5 items-center justify-center align-middle font-xing text-[11px]">告</span>
        {text}
      </p>
    </div>
  )
}

/* 传统佳节临近时, 门面换上节日问候 */
const FESTIVALS = [
  { date: '2026-08-19', name: '七夕', word: '鹊桥已搭,只待二位' },
  { date: '2026-09-25', name: '中秋', word: '月圆人亦团圆,愿你有人共赏' },
  { date: '2026-10-18', name: '重阳', word: '结伴登高,共饮一盏秋茶' },
  { date: '2027-02-06', name: '新春', word: '新岁愿有人相伴' },
]

const NOW = Date.now()

function FestivalBanner() {
  const f = FESTIVALS.find(x => {
    const diff = (new Date(x.date).getTime() - NOW) / 86400_000
    return diff >= -1 && diff <= 30
  })
  if (!f) return null
  return (
    <div className="border-b border-gold/30 bg-gradient-to-r from-gold/15 via-primary/10 to-gold/15">
      <p className="mx-auto max-w-6xl px-4 py-2 text-center text-xs text-foreground/80">
        <span className="seal mr-2 inline-flex h-5 w-5 items-center justify-center align-middle font-xing text-[11px]">{f.name.slice(0, 1)}</span>
        {f.name}将至 · {f.word}
      </p>
    </div>
  )
}

function HotPosts() {
  const { posts, me } = useStore()
  const [detailId, setDetailId] = useState('')
  const [profile, setProfile] = useState<User | null>(null)
  const score = (p: Post) => p.likes.length * 2 + p.comments.length * 3 + (p.featured ? 4 : 0)
  const hot = [...posts].sort((a, b) => score(b) - score(a)).slice(0, 4)
  if (!hot.length) return null
  const detail = hot.find(p => p.id === detailId) ?? null
  return (
    <section className="mx-auto max-w-6xl px-4 pb-4 pt-2">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="flex items-center font-xing text-2xl text-foreground md:text-3xl">
          社区 <span className="text-gold">·</span> 热帖
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 font-sans text-[10px] tracking-widest text-gold">
            {me ? '按互动排序' : '演示内容'}
          </span>
        </h2>
        <Link to="/community" className="text-xs text-primary transition hover:text-primary/80">去社区看看 →</Link>
      </div>
      <p className="-mt-2 mb-4 text-[11px] text-muted-foreground">
        {me ? '按当前可见的心动与回帖排序,24 小时内的新帖带「新帖」标。' : '当前为产品演示内容,不代表真实会员动态或运营热度。'}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [&_article]:mb-0">
        {hot.map(p => (
          <PostTile key={p.id} post={p} fresh={NOW - p.at < 86400_000} onOpen={x => setDetailId(x.id)} onProfile={setProfile} />
        ))}
      </div>
      <PostDialog post={detail} onClose={() => setDetailId('')} />
      <DetailDialog user={profile} onClose={() => setProfile(null)} />
    </section>
  )
}

function WelcomeCard() {
  const { me, tour, markTour } = useStore()
  if (!me || tour.welcome) return null
  return (
    <section className="mx-auto max-w-6xl px-4 pt-8">
      <div className="card-cn flex flex-col items-center gap-4 rounded-lg !border-gold/50 p-6 text-center md:flex-row md:text-left">
        <span className="seal flex h-14 w-14 shrink-0 items-center justify-center font-xing text-2xl">启</span>
        <div className="flex-1">
          <h2 className="font-xing text-2xl text-foreground">新人启程,礼已备好</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            先确认必要资料,再看真人推荐；只有双方都表达「有意」后才会开启佳音。其他功能按需要慢慢探索即可。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to="/me"
            className="btn-gold !px-5 !py-2.5 text-sm"
            onClick={() => { void markTour('welcome').catch(() => {}) }}
          >
            去看清单
          </Link>
          <button className="btn-ghost !px-4 !py-2.5 text-xs text-muted-foreground" onClick={() => { void markTour('welcome').catch(() => {}) }}>
            先自己逛逛
          </button>
        </div>
      </div>
    </section>
  )
}

/* 全站缘分总账: 把公开的站点数据写成一行小账 */
function useCountUp(target: number, ms = 900): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return n
}

function LedgerNum({ num }: { num: number }) {
  const n = useCountUp(num)
  return <span className="cjk-latin block font-xing text-2xl text-foreground">{n}</span>
}

function FateLedger() {
  const { users, posts, events, digests, me } = useStore()
  const seats = events.reduce((s, e) => s + e.attendees.length, 0)
  const hearts = posts.reduce((s, p) => s + p.likes.length, 0)
  const echoes = posts.reduce((s, p) => s + p.comments.length, 0) + events.reduce((s, e) => s + (e.comments ?? []).length, 0)
  const rows = [
    { seal: '人', num: users.length, label: '位同路人' },
    { seal: '帖', num: posts.length, label: '篇真诚分享' },
    { seal: '心', num: hearts, label: '次心动' },
    { seal: '音', num: echoes, label: '句回帖留言' },
    { seal: '席', num: seats, label: '席同席之缘' },
    { seal: '集', num: digests.length, label: '辑每周精选' },
  ]
  return (
    <section className="mx-auto max-w-6xl px-4 pb-4">
      <div className="card-cn rounded-lg px-6 py-5 md:py-6">
        <div className="relative">
          <p className="text-center text-xs tracking-[.4em] text-gold">{me ? '当前可见数据' : '演示数据'}</p>
          {me && (
            <Link to="/report" className="absolute right-0 top-0 text-[11px] text-primary transition hover:text-primary/80">
              我的缘分周报 →
            </Link>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          {rows.map(r => (
            <div key={r.seal} className="flex items-center justify-center gap-2.5">
              <span className="seal flex h-9 w-9 shrink-0 items-center justify-center font-xing text-lg">{r.seal}</span>
              <span className="leading-tight">
                <LedgerNum num={r.num} />
                <span className="block text-[10px] text-muted-foreground">{r.label}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          {me ? '仅统计你当前有权限看到的数据。' : '以下数字来自本地示例数据,仅用于展示产品结构。'}
        </p>
      </div>
    </section>
  )
}

function WeeklyDigest() {
  const { posts, digests, viewDigest } = useStore()
  const [open, setOpen] = useState(false)
  const latest = digests[0] ?? null
  const digestPosts = latest
    ? latest.postIds.map(id => posts.find(p => p.id === id)).filter((p): p is Post => !!p)
    : []
  if (!latest || !digestPosts.length) return null
  return (
    <section className="mx-auto max-w-6xl px-4 pb-4">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-xing text-2xl text-foreground md:text-3xl">
          每周 <span className="text-gold">·</span> 精选合集
        </h2>
        <Link to="/community" className="text-xs text-primary transition hover:text-primary/80">去社区看看 →</Link>
      </div>
      <p className="-mt-1 mb-3 text-[11px] text-muted-foreground">掌柜每周一辑,把本周最动人的分享打包成集。</p>
      <DigestBanner digest={latest} count={digestPosts.length} onOpen={() => { void viewDigest(latest.id); setOpen(true) }} />
      <DigestModal digest={open ? latest : null} posts={digestPosts} onClose={() => setOpen(false)} />
    </section>
  )
}

function MemberDashboard() {
  const { me, conversations, unread, dailyYuanfen, events, matchScore, featureOn, loadDiscoveryProfiles } = useStore()

  useEffect(() => {
    if (!me || !isProfileReadyForMatching(me) || !featureOn('yuanfen')) return
    void loadDiscoveryProfiles({ page: 1, perPage: 48 }).catch(() => {})
    // 候选只在本人必要资料发生变化时重新取；Store 方法引用会随状态更新重建，不能作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, me?.gender, me?.seeking, me?.birthDate, me?.city])

  if (!me) return null

  const convs = conversations()
  const unreadConvs = convs.filter(c => unread(c.user.id) > 0)
  const unreadTotal = unreadConvs.reduce((sum, c) => sum + unread(c.user.id), 0)
  const ready = isProfileReadyForMatching(me)
  const profile = completeness(me)
  const recs = ready && featureOn('yuanfen') ? dailyYuanfen() : []
  const firstRec = recs[0] ?? null
  const now = NOW
  const joined = featureOn('events')
    ? events
        .filter(e => e.attendees.includes(me.id) && new Date(`${e.date}T23:59:59`).getTime() >= now)
        .sort((a, b) => a.date.localeCompare(b.date))
    : []
  const nextEvent = joined[0] ?? null
  const shared = firstRec ? firstRec.interests.filter(t => me.interests.includes(t)).slice(0, 2) : []

  const priority = unreadTotal > 0
    ? { to: '/matches', kicker: '先回一封佳音', title: `${unreadTotal} 条真人消息等你回复`, desc: `来自 ${unreadConvs.length} 段双方已互道「有意」的关系。`, action: '去回复' }
    : !ready
      ? { to: '/me', kicker: '先让资料真实可用', title: '确认必要资料后再进入推荐', desc: '性别、希望认识的对象、出生日期和城市都由你本人确认。', action: '完善资料' }
      : firstRec
        ? { to: '/yuanfen', kicker: '今日关系机会', title: `今天有 ${recs.length} 位符合当前必要条件的人`, desc: '先看推荐理由，再决定是否表达「有意」。', action: '看今日推荐' }
        : { to: '/explore', kicker: '当前推荐池较安静', title: '暂时没有满足双方必要条件的新推荐', desc: '可以用兴趣筛选了解当前真实供给，不用演示账号凑数。', action: '看看兴趣筛选' }

  return (
    <div className="clouds-paper">
      <section className="mx-auto max-w-6xl px-4 py-8 md:py-12">
        <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs tracking-[.35em] text-gold">今天的随缘网</p>
            <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">{me.nickname}，今天先做一件有价值的事</h1>
            <p className="mt-2 text-sm text-muted-foreground">不追求多刷人，先处理真实回应、真实推荐和已经答应的见面。</p>
          </div>
          <Link to="/trust" className="text-xs text-primary transition hover:text-primary/80">安全与隐私说明 →</Link>
        </div>

        <Link to={priority.to} className="card-cn group block rounded-xl !border-gold/50 p-5 transition hover:-translate-y-0.5 hover:shadow-lift md:p-7">
          <p className="text-xs tracking-[.25em] text-gold">{priority.kicker}</p>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-xing text-2xl text-foreground md:text-3xl">{priority.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{priority.desc}</p>
            </div>
            <span className="btn-gold shrink-0 !px-4 !py-2 text-xs">{priority.action}<ChevronRight size={14} /></span>
          </div>
        </Link>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <Link to="/matches" className="card-cn rounded-lg p-4 transition hover:border-primary/40 hover:shadow-card">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><MessageCircleHeart size={16} className="text-primary" />待回复</p>
            <p className="cjk-latin mt-3 font-xing text-3xl text-primary">{unreadTotal}</p>
            <p className="mt-1 text-xs text-muted-foreground">只统计双方真实互道「有意」后的未读消息</p>
          </Link>
          <Link to="/me" className="card-cn rounded-lg p-4 transition hover:border-primary/40 hover:shadow-card">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><UserRoundCheck size={16} className="text-gold" />资料准备度</p>
            <p className="cjk-latin mt-3 font-xing text-3xl text-gold">{profile.pct}%</p>
            <p className="mt-1 text-xs text-muted-foreground">必要资料不完整时不会进入真人推荐池</p>
          </Link>
          <Link to="/events" className="card-cn rounded-lg p-4 transition hover:border-primary/40 hover:shadow-card">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><CalendarHeart size={16} className="text-primary" />已约活动</p>
            <p className="cjk-latin mt-3 font-xing text-3xl text-primary">{joined.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">{nextEvent ? `最近：${nextEvent.date} · ${nextEvent.title}` : '当前没有已确认的未来活动'}</p>
          </Link>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1.3fr_.7fr]">
          <section className="card-cn rounded-lg p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs tracking-[.25em] text-gold">今日推荐预览</p>
                <h2 className="mt-1 font-xing text-2xl text-foreground">先看为什么，再决定要不要认识</h2>
              </div>
              <Link to="/yuanfen" className="text-xs text-primary">查看全部 →</Link>
            </div>
            {firstRec ? (
              <div className="mt-4 flex items-center gap-4 rounded-lg border border-border bg-secondary/35 p-3">
                <img src={firstRec.photos[0]} alt={firstRec.nickname} className="h-16 w-16 shrink-0 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{firstRec.nickname} <span className="cjk-latin ml-2 text-xs font-normal text-gold">规则参考 {matchScore(firstRec)} 分</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{firstRec.city}{firstRec.job ? ` · ${firstRec.job}` : ''}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary">满足双方寻找对象条件</span>
                    {firstRec.city === me.city && <span className="rounded-full bg-secondary px-2 py-1 text-[10px] text-secondary-foreground">同城</span>}
                    {shared.map(t => <span key={t} className="rounded-full bg-secondary px-2 py-1 text-[10px] text-secondary-foreground">共同兴趣 · {t}</span>)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {ready ? '当前没有满足双方必要条件的真人候选。' : '先完成必要资料，推荐才会开始。'}
              </div>
            )}
          </section>

          <section className="card-cn rounded-lg p-5 md:p-6">
            <p className="text-xs tracking-[.25em] text-gold">换一种认识方式</p>
            <h2 className="mt-1 font-xing text-2xl text-foreground">按需要探索</h2>
            <div className="mt-4 space-y-2">
              {featureOn('explore') && <Link to="/explore" className="flex items-center justify-between rounded-md border border-border p-3 text-sm transition hover:border-primary/40"><span className="flex items-center gap-2"><Compass size={15} />兴趣筛选</span><ChevronRight size={14} /></Link>}
              {featureOn('explore') && <Link to="/nearby" className="flex items-center justify-between rounded-md border border-border p-3 text-sm transition hover:border-primary/40"><span>同城</span><ChevronRight size={14} /></Link>}
              {featureOn('community') && <Link to="/community" className="flex items-center justify-between rounded-md border border-border p-3 text-sm transition hover:border-primary/40"><span>生活分享</span><ChevronRight size={14} /></Link>}
              <Link to="/favorites" className="flex items-center justify-between rounded-md border border-border p-3 text-sm transition hover:border-primary/40"><span>我的收藏</span><ChevronRight size={14} /></Link>
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}

export function HomePage() {
  const { me, account, booted, dataReady, bootError, retryBoot } = useStore()
  if (account && (!booted || !dataReady)) {
    return (
      <div className="clouds-paper mx-auto flex min-h-[60vh] max-w-lg items-center px-4 py-16">
        <div className="card-cn w-full rounded-lg p-6 text-center md:p-8">
          <span className="seal mx-auto flex h-12 w-12 font-xing text-lg">{booted ? '停' : '候'}</span>
          <h1 className="mt-4 font-xing text-3xl text-foreground">{booted ? '数据还没有可信加载' : '正在载入你的真实数据'}</h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            {booted ? (bootError || '当前无法确认服务端数据状态，因此不会展示旧状态或执行关系操作。') : '确认服务端状态后再进入今日任务台。'}
          </p>
          {booted && <button className="btn-primary mt-5" onClick={retryBoot}>重新加载数据</button>}
        </div>
      </div>
    )
  }
  if (me) {
    return (
      <>
        <Announcement />
        <FestivalBanner />
        <MemberDashboard />
        <WelcomeCard />
      </>
    )
  }
  return (
    <>
      <Announcement />
      <FestivalBanner />
      <Hero />
      <Features />
      <Stories />
      <WeeklyDigest />
      <HotPosts />
      <Moments />
      <FateLedger />
      <CtaBand />
    </>
  )
}
