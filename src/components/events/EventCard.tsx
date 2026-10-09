import { BellRing, CalendarDays, MapPin, Pin } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import type { EventItem } from '@/lib/store'
import { cn } from '@/lib/utils'

export function EventCard({ event, onOpen, album }: { event: EventItem; onOpen: (e: EventItem) => void; album?: boolean }) {
  const { users, me, reminders, settings, checkins } = useStore()
  const isSameCity = !!me?.city && event.city === me.city
  const d = new Date(event.date)
  const joined = me ? event.attendees.includes(me.id) : false
  const checkedIn = me ? (checkins[me.id] ?? []).includes(event.id) : false
  const reminded = reminders.includes(event.id)
  const hidden = settings.hiddenEvents.includes(event.id)
  const full = event.attendees.length >= event.capacity
  const remaining = Math.max(0, event.capacity - event.attendees.length)
  const past = event.date < new Date().toISOString().slice(0, 10)
  const imgs = event.images ?? []
  const cs = event.comments ?? []
  const quote = cs.length ? (cs.find(c => c.pinned) ?? cs[cs.length - 1]).text : ''

  return (
    <button type="button" className="card-cn group block w-full cursor-pointer overflow-hidden rounded-lg text-left transition hover:-translate-y-1 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onOpen(event)} aria-label={`查看活动：${event.title}`}>
      <div className="relative">
        <img src={event.cover} alt={event.title} loading="lazy" className={cn('aspect-[16/9] w-full object-cover transition duration-500 group-hover:scale-105', past && 'opacity-80 saturate-[.7]')} />
        <div className="absolute left-3 top-3 flex h-14 w-14 flex-col items-center justify-center rounded-md bg-card/95 shadow-card">
          <span className="cjk-latin font-xing text-xl leading-none text-primary">{d.getDate()}</span>
          <span className="text-[9px] text-muted-foreground">{d.getMonth() + 1}月</span>
        </div>
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          {event.pinned && (
            <span className="seal flex items-center gap-0.5 px-1.5 py-0.5 text-[10px]">
              <Pin size={10} />
              置顶
            </span>
          )}
          {hidden && <span className="rounded-sm bg-muted/90 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-card">已隐藏</span>}
          {past && <span className="rounded-sm bg-muted/90 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-card">已结束</span>}
          {reminded && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-card/95 text-gold shadow-card" title="已设提醒">
              <BellRing size={12} />
            </span>
          )}
          {me && event.creatorId === me.id && <span className="seal px-1.5 py-0.5 text-[10px]">我发起</span>}
          {joined && <span className="seal px-1.5 py-0.5 text-[10px]">已报名</span>}
          {checkedIn && <span className="rounded-sm bg-gold px-1.5 py-0.5 text-[10px] text-accent-foreground shadow-card">已打卡</span>}
        </div>
      </div>
      {album && (imgs.length > 0 || quote) && (
        <div className="px-4 pt-2.5">
          {imgs.length > 0 && (
            <>
              <p className="mb-1 text-[10px] tracking-widest text-muted-foreground">
                精彩瞬间 · <span className="cjk-latin">{imgs.length}</span> 张
              </p>
              <div className="flex gap-1">
                {imgs.slice(0, 4).map((img, i) => (
                  <img key={i} src={img} alt="" className="h-14 min-w-0 flex-1 rounded-sm border border-border object-cover" />
                ))}
              </div>
            </>
          )}
          {quote && (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">留声:「{quote}」</p>
          )}
        </div>
      )}
      <div className="space-y-2.5 p-4">
        <h3 className="font-xing text-xl text-foreground">{event.title}</h3>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5"><MapPin size={11} />{event.region || event.city}</span>
          {isSameCity && (
            <span className="rounded-full bg-gold/90 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-red-ink" title="与你同城">
              同城
            </span>
          )}
          <span className="inline-flex items-center gap-0.5"><CalendarDays size={11} />{event.date} {event.time}</span>
        </p>
        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{event.venue ? `集合：${event.venue}` : '集合区域待发起人确认'} · {event.costNote ? `费用：${event.costNote}` : '费用待确认'}</p>
        <div className="flex flex-wrap gap-1">
          {event.tags.map(t => (
            <span key={t} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground/80">{t}</span>
          ))}
        </div>
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn('h-full rounded-full transition-all duration-500', full ? 'bg-gold' : 'bg-gradient-to-r from-primary to-gold')}
              style={{ width: `${Math.min(100, (event.attendees.length / event.capacity) * 100)}%` }}
            />
          </div>
          <p className="cjk-latin mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>名额 {event.attendees.length}/{event.capacity}</span>
            {full ? (
              <span className="text-gold">已满员</span>
            ) : remaining <= 3 ? (
              <span className="font-semibold text-primary">仅剩 {remaining} 席</span>
            ) : (
              <span>余 {remaining} 席</span>
            )}
          </p>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <div className="flex -space-x-2">
            {event.attendees.slice(0, 4).map(id => {
              const u = users.find(x => x.id === id)
              return u ? <img key={id} src={u.photos[0]} alt="" className="h-6 w-6 rounded-full border-2 border-card object-cover" /> : null
            })}
          </div>
          <span className={`text-[11px] font-semibold ${past || (full && !joined) ? 'text-muted-foreground' : 'text-primary'}`}>
            {past ? '已结束' : joined ? '已结缘' : full ? '已满员' : '报名牵线'}
          </span>
        </div>
      </div>
    </button>
  )
}
