import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarHeart, Compass, MapPin } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { EventItem, User } from '@/lib/store'
import { districtOf, districtsOf } from '@/lib/region'
import { ProfileCard } from '@/components/ProfileCard'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { EventCard } from '@/components/events/EventCard'
import { EventDetail } from '@/components/events/EventDetail'
import { cn } from '@/lib/utils'

export function NearbyPage() {
  const { candidates, matchScore, me, events, settings } = useStore()
  const [district, setDistrict] = useState('')
  const [detail, setDetail] = useState<User | null>(null)
  const [eventDetail, setEventDetail] = useState<EventItem | null>(null)

  const local = useMemo(() => {
    if (!me?.city) return []
    return candidates()
      .filter(u => u.city === me.city)
      .sort((a, b) => matchScore(b) - matchScore(a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, me?.city, me?.id])

  // 区县小签: 只列出真有人的区县, 按官方名录排
  const districts = useMemo(() => {
    const counts = new Map<string, number>()
    local.forEach(u => {
      const d = districtOf(u)
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1)
    })
    const ordered = districtsOf(me?.city ?? '').filter(d => counts.has(d))
    for (const d of counts.keys()) if (!ordered.includes(d)) ordered.push(d)
    return ordered.map(d => ({ name: d, n: counts.get(d)! }))
  }, [local, me?.city])

  const shown = district ? local.filter(u => districtOf(u) === district) : local

  // 同城聚会: 只看未落幕的, 按日期近的先来; 区县小签只管人, 聚会按全城看
  const localEvents = useMemo(() => {
    if (!me?.city) return []
    const today = new Date().toISOString().slice(0, 10)
    return events
      .filter(e => e.city === me.city && e.date >= today)
      .filter(e => !settings.hiddenEvents.includes(e.id) || me.role === 'admin' || e.creatorId === me.id)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [events, settings.hiddenEvents, me])

  if (!me) return null

  if (!me.city) {
    return (
      <div className="clouds-paper mx-auto max-w-md px-4 py-24 text-center">
        <span className="seal mx-auto flex h-14 w-14 items-center justify-center font-xing text-2xl">近</span>
        <h1 className="mt-4 font-xing text-3xl text-foreground">先说说你在哪座城</h1>
        <p className="mt-2 text-sm text-muted-foreground">填好所在城市,才能把身边的有缘人挑到你面前。</p>
        <Link to="/me" className="btn-gold mt-6 inline-flex">去完善资料</Link>
      </div>
    )
  }

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">附近的人</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">同城之缘</h1>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Compass size={14} className="text-gold" />
          <span className="inline-flex items-center gap-0.5"><MapPin size={12} />{me.region || me.city}</span>
          的有缘人,都在这儿
        </p>
      </div>

      {districts.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setDistrict('')}
            className={cn('rounded-full border px-3.5 py-1.5 text-xs transition', !district ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40')}
          >
            全城 · <span className="cjk-latin">{local.length}</span>
          </button>
          {districts.map(d => (
            <button
              key={d.name}
              onClick={() => setDistrict(p => (p === d.name ? '' : d.name))}
              className={cn('cjk-latin rounded-full border px-3.5 py-1.5 text-xs transition', district === d.name ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40')}
            >
              {d.name} · {d.n}
            </button>
          ))}
        </div>
      )}

      {shown.length ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map(u => <ProfileCard key={u.id} user={u} onOpen={setDetail} />)}
        </div>
      ) : (
        <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center">
          <h3 className="font-xing text-2xl text-foreground">{district ? '这个区县还静悄悄' : '同城暂无可看的有缘人'}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {district ? '放宽到全城看看,缘分未必隔着一条街。' : '兴许缘分还在路上,先去兴趣匹配逛逛,或过几天再来看看。'}
          </p>
          {district ? (
            <button className="btn-outline mt-6" onClick={() => setDistrict('')}>看全城</button>
          ) : (
            <Link to="/explore" className="btn-outline mt-6 inline-flex">去兴趣匹配</Link>
          )}
        </div>
      )}

      {localEvents.length > 0 && (
        <section className="mt-14">
          <div className="mb-1 flex items-center justify-center gap-3">
            <span className="h-px w-12 bg-gold/40" />
            <h2 className="font-xing text-2xl text-foreground md:text-3xl">同城 · 聚会</h2>
            <span className="h-px w-12 bg-gold/40" />
          </div>
          <p className="mb-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarHeart size={12} className="text-gold" />
            同在一城,见一面比聊十句更近
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {localEvents.map(e => <EventCard key={e.id} event={e} onOpen={setEventDetail} />)}
          </div>
        </section>
      )}

      <DetailDialog user={detail} onClose={() => setDetail(null)} />
      <EventDetail event={eventDetail} onClose={() => setEventDetail(null)} />
    </div>
  )
}
