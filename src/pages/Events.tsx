import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, CalendarPlus, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { EventItem, EventListScope } from '@/lib/store-types'
import { daysUntil } from '@/lib/store-model'
import { EventCard } from '@/components/events/EventCard'
import { EventCalendar } from '@/components/events/EventCalendar'
import { EventDetail } from '@/components/events/EventDetail'
import { EventForm } from '@/components/events/EventForm'
import { cn } from '@/lib/utils'

const FILTERS = [
  { key: 'all', label: '全部活动' },
  { key: 'hanfu', label: '汉服专场' },
  { key: 'mine', label: '我报名的' },
  { key: 'hosted', label: '我发起的' },
  { key: 'calendar', label: '活动日历' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

const scopeOf = (filter: FilterKey): EventListScope =>
  filter === 'all' ? 'upcoming' : filter === 'calendar' ? 'calendar' : filter

export function EventsPage() {
  const { events, reminders, loadEventsPage, loadEventDetail } = useStore()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const [pastIds, setPastIds] = useState<string[]>([])
  const [calendarIds, setCalendarIds] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [detailId, setDetailId] = useState('')
  const [openingId, setOpeningId] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EventItem | null>(null)
  const loadEventsRef = useRef(loadEventsPage)
  const loadDetailRef = useRef(loadEventDetail)
  const calendarRequestRef = useRef(0)

  useEffect(() => { loadEventsRef.current = loadEventsPage }, [loadEventsPage])
  useEffect(() => { loadDetailRef.current = loadEventDetail }, [loadEventDetail])

  useEffect(() => {
    if (filter === 'calendar') return
    let alive = true
    void loadEventsRef.current({
      page: 1,
      perPage: 18,
      scope: scopeOf(filter),
      localFirst: filter === 'all' || filter === 'hanfu',
    })
      .then(res => {
        if (!alive) return
        setVisibleIds(res.items.map(e => e.id))
        setPage(res.page)
        setTotalItems(res.totalItems)
        setTotalPages(res.totalPages)
        setError('')
      })
      .catch(e => {
        if (alive) setError(e instanceof Error ? e.message : '活动列表加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [filter, retryKey])

  useEffect(() => {
    let alive = true
    void loadEventsRef.current({ page: 1, perPage: 6, scope: 'past', localFirst: false })
      .then(res => {
        if (alive) setPastIds(res.items.map(e => e.id))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const reminderKey = reminders.join('|')
  useEffect(() => {
    const ids = reminderKey ? reminderKey.split('|').filter(Boolean) : []
    if (!ids.length) return
    void loadEventsRef.current({ page: 1, perPage: Math.min(36, ids.length), ids, localFirst: false }).catch(() => {})
  }, [reminderKey])

  const list = visibleIds.map(id => events.find(e => e.id === id)).filter((e): e is EventItem => !!e)
  const pastList = pastIds.map(id => events.find(e => e.id === id)).filter((e): e is EventItem => !!e)
  const calendarEvents = calendarIds.map(id => events.find(e => e.id === id)).filter((e): e is EventItem => !!e)
  const detail = detailId ? events.find(e => e.id === detailId) ?? null : null
  const soon = useMemo(
    () => reminders
      .map(id => events.find(e => e.id === id))
      .filter((e): e is EventItem => !!e)
      .map(event => ({ event, days: daysUntil(event.date) }))
      .filter(x => x.days >= 0 && x.days <= 7)
      .sort((a, b) => a.days - b.days),
    [events, reminders],
  )

  const beginFilter = (next: FilterKey) => {
    setFilter(next)
    if (next !== 'calendar') {
      setVisibleIds([])
      setPage(1)
      setLoading(true)
      setError('')
    }
  }

  const retry = () => {
    setVisibleIds([])
    setPage(1)
    setLoading(true)
    setError('')
    setRetryKey(v => v + 1)
  }

  const loadMore = async () => {
    if (loading || page >= totalPages || filter === 'calendar') return
    setLoading(true)
    setError('')
    try {
      const res = await loadEventsRef.current({
        page: page + 1,
        perPage: 18,
        scope: scopeOf(filter),
        localFirst: filter === 'all' || filter === 'hanfu',
      })
      setVisibleIds(prev => [...prev, ...res.items.map(e => e.id).filter(id => !prev.includes(id))])
      setPage(res.page)
      setTotalItems(res.totalItems)
      setTotalPages(res.totalPages)
    } catch (e) {
      setError(e instanceof Error ? e.message : '下一页活动加载失败')
    } finally {
      setLoading(false)
    }
  }

  const openEvent = async (event: EventItem) => {
    if (openingId) return
    setOpeningId(event.id)
    try {
      await loadDetailRef.current(event.id)
      setDetailId(event.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '活动详情暂时无法加载')
    } finally {
      setOpeningId('')
    }
  }

  const loadCalendarRange = useCallback((from: string, to: string) => {
    // 连续快速切换月份时，旧请求不能覆盖新月份的数据和加载状态。
    const requestId = ++calendarRequestRef.current
    setCalendarLoading(true)
    setCalendarError('')
    setCalendarIds([])
    void loadEventsRef.current({ page: 1, perPage: 120, scope: 'calendar', from, to, localFirst: false })
      .then(res => {
        if (requestId === calendarRequestRef.current) setCalendarIds(res.items.map(e => e.id))
      })
      .catch(e => {
        if (requestId === calendarRequestRef.current) setCalendarError(e instanceof Error ? e.message : '本月活动加载失败')
      })
      .finally(() => {
        if (requestId === calendarRequestRef.current) setCalendarLoading(false)
      })
  }, [])

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    if (filter !== 'calendar') retry()
  }

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-7 md:py-14">
      <div className="mb-6 text-center md:mb-8">
        <p className="text-xs tracking-[.4em] text-gold">活动牵线</p>
        <h1 className="mt-2 font-xing text-3xl text-foreground sm:text-4xl md:text-5xl">同席之缘</h1>
        <p className="mt-2 text-sm text-muted-foreground">一场茶会、一次登高,比一百句开场白更自然——同城的相聚,优先安排</p>
        <button className="btn-gold mt-5 transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[.97]" onClick={() => setFormOpen(true)}>
          <CalendarPlus size={16} />
          发起一场活动
        </button>
      </div>

      {soon.length > 0 && (
        <div className="card-cn mx-auto mb-8 max-w-3xl rounded-lg p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs tracking-widest text-gold">
            <BellRing size={13} />
            临近的活动提醒
          </p>
          <div className="flex flex-wrap gap-2">
            {soon.map(({ event, days }) => (
              <button
                key={event.id}
                onClick={() => { void openEvent(event) }}
                className="flex items-center gap-2 rounded-full border border-gold/50 bg-card px-3 py-1.5 text-xs text-foreground/85 transition hover:border-primary/60 hover:shadow-card"
              >
                <span className="max-w-40 truncate">{event.title}</span>
                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', days <= 1 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground/80')}>
                  {days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天后`}
                </span>
                <span className="cjk-latin text-[10px] text-muted-foreground">{event.time}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div aria-label="活动筛选" className="-mx-4 mb-6 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-4 pb-2 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => beginFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn('min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border px-4 py-2 text-sm transition', filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filter === 'hanfu' && (
        <div className="relative mb-6 overflow-hidden rounded-lg border border-gold/40 bg-gradient-to-r from-red-ink to-primary p-6 text-primary-foreground">
          <span className="pointer-events-none absolute -right-4 -top-8 select-none font-xing text-[7rem] leading-none text-gold-soft/15">襦</span>
          <p className="text-xs tracking-[.35em] text-gold-soft">汉服专场</p>
          <h2 className="mt-1 font-xing text-3xl">罗衣何飘飘,轻裾随风还</h2>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-primary-foreground/75">
            着一袭汉服赴一场相逢——提灯、猜谜、听评弹,衣冠里藏着最认真的浪漫。
          </p>
        </div>
      )}

      {openingId && (
        <p className="mb-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />正在读取活动详情…
        </p>
      )}

      {filter === 'calendar' ? (
        <>
          {calendarError && (
            <div className="mb-4 rounded-md border border-border bg-secondary/40 p-3 text-center text-xs text-muted-foreground">
              {calendarError}
            </div>
          )}
          {calendarLoading && <p className="mb-3 text-center text-xs text-muted-foreground">正在读取本月活动…</p>}
          <EventCalendar events={calendarEvents} onOpen={e => { void openEvent(e) }} onRangeChange={loadCalendarRange} />
        </>
      ) : error && page === 1 ? (
        <div className="card-cn mx-auto max-w-md rounded-lg p-8 text-center">
          <h3 className="font-xing text-2xl text-foreground">活动列表暂时没有加载成功</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <button className="btn-outline mt-5" onClick={retry}><RefreshCw size={14} />重新加载</button>
        </div>
      ) : loading && page === 1 ? (
        <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center text-sm text-muted-foreground">
          <Loader2 size={20} className="mx-auto mb-3 animate-spin text-primary" />
          正在加载真实活动…
        </div>
      ) : list.length ? (
        <>
          <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>当前分类共 {totalItems} 场 · 每次最多加载 18 场</span>
            {error && <button className="text-primary" onClick={() => { void loadMore() }}>上一轮加载失败，重试</button>}
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {list.map(e => <EventCard key={e.id} event={e} onOpen={x => { void openEvent(x) }} />)}
          </div>
          {page < totalPages && (
            <div className="mt-8 text-center">
              <button className="btn-outline min-w-40" disabled={loading} onClick={() => { void loadMore() }}>
                {loading ? <><Loader2 size={14} className="animate-spin" />加载中…</> : '加载更多'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center">
          <h3 className="font-xing text-2xl text-foreground">
            {filter === 'hosted' ? '你还没发起过活动' : filter === 'mine' ? '还没有报名的活动' : '近期暂无新活动'}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {filter === 'hosted'
              ? '做东攒一场局,让同好循着主题来找你。'
              : filter === 'mine'
                ? '挑一场感兴趣的活动,把缘分从线上带到线下。'
                : '往下翻翻往期回顾,或干脆由你发起一场新相聚。'}
          </p>
          <button className="btn-primary mt-6" onClick={() => (filter === 'hosted' ? setFormOpen(true) : beginFilter('all'))}>
            {filter === 'hosted' ? '发起一场活动' : '看看全部活动'}
          </button>
        </div>
      )}

      {filter !== 'calendar' && pastList.length > 0 && (
        <section className="mt-14">
          <div className="mb-1 flex items-center justify-center gap-3">
            <span className="h-px w-12 bg-gold/40" />
            <h2 className="font-xing text-2xl text-foreground md:text-3xl">往期 · 回顾</h2>
            <span className="h-px w-12 bg-gold/40" />
          </div>
          <p className="mb-6 text-center text-[11px] text-muted-foreground">已落幕的相聚,也曾促成不少佳缘。</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pastList.map(e => <EventCard key={e.id} event={e} onOpen={x => { void openEvent(x) }} album />)}
          </div>
        </section>
      )}

      <EventDetail
        event={detail}
        onClose={() => setDetailId('')}
        onEdit={e => { setDetailId(''); setFormOpen(true); setEditing(e) }}
      />
      {formOpen && (
        <EventForm
          open
          initial={editing}
          onClose={closeForm}
        />
      )}
    </div>
  )
}
