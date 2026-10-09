import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarHeart, Compass, MapPin, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { EventItem, User } from '@/lib/store'
import { districtOf, districtsOf } from '@/lib/region'
import { ProfileCard } from '@/components/ProfileCard'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { EventCard } from '@/components/events/EventCard'
import { EventDetail } from '@/components/events/EventDetail'
import { cn } from '@/lib/utils'
import { isProfileReadyForMatching } from '@/lib/store-model'

export function NearbyPage() {
  const { me } = useStore()
  return <NearbyContent key={`${me?.id ?? ''}:${me?.city ?? ''}`} />
}

function NearbyContent() {
  const { matchScore, me, events, settings, loadEventsPage, loadEventDetail, loadDiscoveryProfiles } = useStore()
  const [people, setPeople] = useState<User[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [peopleLoading, setPeopleLoading] = useState(true)
  const [peopleError, setPeopleError] = useState('')
  const [retry, setRetry] = useState(0)
  const loadPeopleRef = useRef(loadDiscoveryProfiles)
  useEffect(() => { loadPeopleRef.current = loadDiscoveryProfiles }, [loadDiscoveryProfiles])
  const [district, setDistrict] = useState('')
  const [detail, setDetail] = useState<User | null>(null)
  const [eventDetail, setEventDetail] = useState<EventItem | null>(null)
  const loadEventsRef = useRef(loadEventsPage)
  const loadDetailRef = useRef(loadEventDetail)
  useEffect(() => { loadEventsRef.current = loadEventsPage }, [loadEventsPage])
  useEffect(() => { loadDetailRef.current = loadEventDetail }, [loadEventDetail])
  useEffect(() => {
    if (!me?.city) return
    void loadEventsRef.current({ page: 1, perPage: 36, scope: 'upcoming', city: me.city, localFirst: false }).catch(() => {})
  }, [me?.city])

  const city = me?.city ?? ''
  const eligible = !!me && isProfileReadyForMatching(me)
  useEffect(() => {
    if (!eligible || !city) return
    let active = true
    void Promise.resolve().then(() => { if (active) setPeopleLoading(true) })
    void loadPeopleRef.current({ page, perPage: 24, city })
      .then(result => {
        if (!active) return
        setPeople(prev => page === 1 ? result.items : [...prev, ...result.items.filter(u => !prev.some(p => p.id === u.id))])
        setTotalPages(result.totalPages)
        setTotalItems(result.totalItems)
        setPeopleError('')
      })
      .catch(err => { if (active) setPeopleError(err instanceof Error ? err.message : '同城候选加载失败') })
      .finally(() => { if (active) setPeopleLoading(false) })
    return () => { active = false }
  }, [eligible, city, page, retry])

  const openEvent = async (event: EventItem) => {
    try {
      setEventDetail(await loadDetailRef.current(event.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '活动详情暂时无法加载')
    }
  }

  const local = useMemo(() => {
    if (!me?.city) return []
    return people
      .filter(u => u.city === me.city)
      .sort((a, b) => matchScore(b) - matchScore(a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, me?.city, me?.id, matchScore])

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

  if (!eligible) {
    return (
      <div className="clouds-paper mx-auto max-w-md px-4 py-24 text-center">
        <span className="seal mx-auto flex h-14 w-14 items-center justify-center font-xing text-2xl">近</span>
        <h1 className="mt-4 font-xing text-3xl text-foreground">先确认必要资料</h1>
        <p className="mt-2 text-sm text-muted-foreground">确认性别、希望认识的对象、成年出生日期和城市之后，才会展示真实同城候选。</p>
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
            已加载 · <span className="cjk-latin">{local.length}</span>
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

      {totalItems > 0 && <p className="mb-4 text-center text-xs text-muted-foreground">符合条件的同城候选共 {totalItems} 位 · 当前已加载 {local.length} 位，区县数字仅统计已加载范围</p>}
      {peopleError && <div role="alert" className="mx-auto mb-5 max-w-lg rounded-md border border-border p-4 text-center text-sm">同城人物加载未成功：{peopleError}<button className="btn-outline ml-3" onClick={() => { setPeopleLoading(true); setRetry(v => v + 1) }}><RefreshCw size={14} />重试</button></div>}
      {peopleLoading && people.length === 0 && <p className="mb-5 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />正在查找同城真人候选…</p>}
      {shown.length ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map(u => <ProfileCard key={u.id} user={u} onOpen={setDetail} />)}
        </div>
      ) : !peopleLoading && !peopleError ? (
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
      ) : null}

      {page < totalPages && !peopleError && <div className="mt-6 text-center"><button className="btn-outline" disabled={peopleLoading} onClick={() => { setPeopleLoading(true); setPage(p => p + 1) }}>{peopleLoading ? '加载中…' : '加载更多同城候选'}</button></div>}

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
            {localEvents.map(e => <EventCard key={e.id} event={e} onOpen={x => { void openEvent(x) }} />)}
          </div>
        </section>
      )}

      <DetailDialog user={detail} onClose={() => setDetail(null)} />
      <EventDetail event={eventDetail} onClose={() => setEventDetail(null)} />
    </div>
  )
}
