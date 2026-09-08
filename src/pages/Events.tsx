import { useMemo, useState } from 'react'
import { BellRing, CalendarPlus } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { EventItem } from '@/lib/store'
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

export function EventsPage() {
  const { events, me, upcomingReminded, settings } = useStore()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [detail, setDetail] = useState<EventItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EventItem | null>(null)

  const soon = useMemo(() => upcomingReminded().filter(x => x.days <= 7), [upcomingReminded, events])

  // 被管理员隐藏的活动: 发起人与管理员自己仍可见, 其余人不展示
  const shown = useMemo(
    () => events.filter(e => !settings.hiddenEvents.includes(e.id) || me?.role === 'admin' || e.creatorId === me?.id),
    [events, settings.hiddenEvents, me],
  )

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const list = useMemo(() => {
    const browse = filter === 'all' || filter === 'hanfu'
    // 同城活动优先: 浏览列表里与我同城的排前, 其次置顶, 再按日期
    const sameCity = (e: EventItem) => browse && !!me?.city && e.city === me.city
    const sorted = [...shown].sort((a, b) =>
      Number(sameCity(b)) - Number(sameCity(a)) || Number(!!b.pinned) - Number(!!a.pinned) || a.date.localeCompare(b.date))
    let arr = sorted
    if (me) {
      if (filter === 'mine') arr = sorted.filter(e => e.attendees.includes(me.id))
      else if (filter === 'hosted') arr = sorted.filter(e => e.creatorId === me.id)
      else if (filter === 'hanfu') arr = sorted.filter(e => e.tags.includes('汉服') || e.title.includes('汉服'))
    }
    if (filter === 'all' || filter === 'hanfu') arr = arr.filter(e => e.date >= today)
    return arr
  }, [shown, filter, me, today])

  // 已落幕的活动单独成「往期回顾」, 不再混在可报名列表里
  const pastList = useMemo(() => [...shown].filter(e => e.date < today).sort((a, b) => b.date.localeCompare(a.date)), [shown, today])

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">活动牵线</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">同席之缘</h1>
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
                onClick={() => setDetail(event)}
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

      <div className="mb-6 flex justify-center gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn('rounded-full border px-4 py-1.5 text-sm transition', filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40')}
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

      {filter === 'calendar' ? (
        <EventCalendar events={shown} onOpen={setDetail} />
      ) : list.length ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(e => <EventCard key={e.id} event={e} onOpen={setDetail} />)}
        </div>
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
          <button className="btn-primary mt-6" onClick={() => (filter === 'hosted' ? setFormOpen(true) : setFilter('all'))}>
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
            {pastList.map(e => (
              <EventCard key={e.id} event={e} onOpen={setDetail} album />
            ))}
          </div>
        </section>
      )}

      <EventDetail event={detail} onClose={() => setDetail(null)} onEdit={e => { setDetail(null); setFormOpen(true); setEditing(e) }} />
      {formOpen && (
        <EventForm
          open
          initial={editing}
          onClose={() => { setFormOpen(false); setEditing(null) }}
        />
      )}
    </div>
  )
}
