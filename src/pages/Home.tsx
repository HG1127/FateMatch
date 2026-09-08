import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { useStore } from '@/lib/store'
import type { Post, User } from '@/lib/store'

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
  const { posts } = useStore()
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
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            实时榜
          </span>
        </h2>
        <Link to="/community" className="text-xs text-primary transition hover:text-primary/80">去社区看看 →</Link>
      </div>
      <p className="-mt-2 mb-4 text-[11px] text-muted-foreground">按心动与回帖实时排序,24 小时内的新帖带「新帖」标。</p>
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
            我们为你备了一份启程清单:完善资料、点亮验证、送声招呼……六事皆备,缘自会循光而来。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to="/me"
            className="btn-gold !px-5 !py-2.5 text-sm"
            onClick={() => markTour('welcome')}
          >
            去看清单
          </Link>
          <button className="btn-ghost !px-4 !py-2.5 text-xs text-muted-foreground" onClick={() => markTour('welcome')}>
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
  const { users, posts, events, digests } = useStore()
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
          <p className="text-center text-xs tracking-[.4em] text-gold">缘分总账</p>
          <Link to="/report" className="absolute right-0 top-0 text-[11px] text-primary transition hover:text-primary/80">
            我的缘分周报 →
          </Link>
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
        <p className="mt-4 text-center text-[11px] text-muted-foreground">每一个数字,都是一次认真的相逢。</p>
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
      <DigestBanner digest={latest} count={digestPosts.length} onOpen={() => { viewDigest(latest.id); setOpen(true) }} />
      <DigestModal digest={open ? latest : null} posts={digestPosts} onClose={() => setOpen(false)} />
    </section>
  )
}

export function HomePage() {
  return (
    <>
      <Announcement />
      <FestivalBanner />
      <Hero />
      <WelcomeCard />
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
