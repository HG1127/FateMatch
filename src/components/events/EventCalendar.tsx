import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import type { EventItem } from '@/lib/store'
import { EventCard } from '@/components/events/EventCard'
import { FESTS } from '@/lib/festivals'
import { cn } from '@/lib/utils'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function EventCalendar({ events, onOpen, onRangeChange }: { events: EventItem[]; onOpen: (e: EventItem) => void; onRangeChange?: (from: string, to: string) => void }) {
  const { me } = useStore()
  const today = new Date()
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [picked, setPicked] = useState('')

  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7 // 周一开头
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate())
  const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`
  const monthFests = Object.entries(FESTS).filter(([k]) => k.startsWith(monthKey))

  useEffect(() => {
    onRangeChange?.(dateKey(y, m, 1), dateKey(y, m, daysInMonth))
  }, [y, m, daysInMonth, onRangeChange])

  const byDate = new Map<string, EventItem[]>()
  events.forEach(e => {
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  })

  const jumpTo = (year: number, month: number) => {
    setCursor(new Date(year, month, 1))
    setPicked('')
  }
  const shiftMonth = (delta: number) => jumpTo(y, m + delta)
  const firstYear = Math.min(y, today.getFullYear() - 30)
  const years = Array.from({ length: Math.max(61, y - firstYear + 1) }, (_, i) => firstYear + i)

  const dayEvents = picked ? byDate.get(picked) ?? [] : []

  return (
    <div className="space-y-5">
      <div className="card-cn rounded-lg p-3 sm:p-4 md:p-5">
        <div className="mb-2 flex items-center justify-between gap-1">
          <button type="button" className="btn-ghost min-h-11 min-w-11 !px-1" onClick={() => shiftMonth(-1)} aria-label="上一月">
            <ChevronLeft size={20} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5">
            <select aria-label="日历年份" className="input-cn !w-[90px] min-w-0 !px-1.5 text-center tabular-nums" value={y} onChange={e => jumpTo(Number(e.target.value), m)}>
              {years.map(year => <option key={year} value={year}>{year} 年</option>)}
            </select>
            <select aria-label="日历月份" className="input-cn !w-[73px] min-w-0 !px-1.5 text-center tabular-nums" value={m} onChange={e => jumpTo(y, Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{i + 1} 月</option>)}
            </select>
          </div>
          <button type="button" className="btn-ghost min-h-11 min-w-11 !px-1" onClick={() => shiftMonth(1)} aria-label="下一月">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="mb-3 flex justify-center">
          <button type="button" className="min-h-10 rounded-full border border-border bg-card px-4 text-xs text-primary transition hover:border-primary" onClick={() => jumpTo(today.getFullYear(), today.getMonth())}>
            回到本月
          </button>
        </div>
        {monthFests.length > 0 && (
          <div className="mb-2 flex flex-wrap justify-center gap-1.5">
            {monthFests.map(([k, name]) => (
              <button
                key={k}
                onClick={() => setPicked(p => (p === k ? '' : k))}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-[10px] transition',
                  picked === k ? 'border-gold bg-gold text-accent-foreground' : 'border-gold/50 bg-gold/10 text-gold hover:bg-gold/20',
                )}
              >
                {name} · <span className="cjk-latin">{Number(k.slice(8, 10))}</span> 日
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEK.map(w => (
            <span key={w} className="pb-1 text-[11px] tracking-widest text-muted-foreground">{w}</span>
          ))}
          {Array.from({ length: startPad }).map((_, i) => <span key={`pad${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
            const key = dateKey(y, m, d)
            const list = byDate.get(key) ?? []
            const hasJoined = me && list.some(e => e.attendees.includes(me.id))
            return (
              <button
                key={key}
                type="button"
                aria-label={`${y}年${m + 1}月${d}日，${list.length}场活动${FESTS[key] ? `，${FESTS[key]}` : ''}`}
                aria-pressed={picked === key}
                onClick={() => setPicked(p => (p === key ? '' : key))}
                className={cn(
                  'relative flex min-h-11 flex-col items-center justify-center rounded-md border text-sm transition',
                  picked === key ? 'border-primary bg-primary text-primary-foreground' : 'border-transparent hover:bg-muted',
                  key === todayKey && picked !== key && 'border-gold/60 text-primary',
                  list.length === 0 && picked !== key && 'text-foreground/40',
                )}
              >
                <span className={cn('cjk-latin', FESTS[key] && picked !== key && 'font-semibold text-gold')}>{d}</span>
                {(list.length > 0 || FESTS[key]) && (
                  <span className="mt-0.5 flex items-center gap-0.5">
                    {FESTS[key] && (
                      <span title={FESTS[key]} className={cn('h-1.5 w-1.5 rotate-45', picked === key ? 'bg-primary-foreground' : 'bg-gold')} />
                    )}
                    {list.slice(0, 3).map(e => (
                      <span key={e.id} className={cn('h-1 w-1 rounded-full', picked === key ? 'bg-primary-foreground' : hasJoined && e.attendees.includes(me?.id ?? '') ? 'bg-gold' : 'bg-primary')} />
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {picked && (
          <p role="status" className="mt-3 rounded-md bg-primary/5 px-3 py-2 text-center text-sm font-semibold text-primary">
            {Number(picked.slice(5, 7))} 月 {Number(picked.slice(8, 10))} 日：{(byDate.get(picked) ?? []).length} 场活动
          </p>
        )}
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-primary" />有活动</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-gold" />已报名</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rotate-45 bg-gold" />传统佳节</span>
          <span className="inline-flex items-center gap-1"><CalendarDays size={11} />点日期看当天安排</span>
        </p>
      </div>

      {picked && (
        dayEvents.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {dayEvents.map(e => <EventCard key={e.id} event={e} onOpen={onOpen} />)}
          </div>
        ) : (
          <p className="card-cn rounded-lg p-6 text-center text-sm text-muted-foreground">
            {FESTS[picked] ? `这天是${FESTS[picked]}。佳节尚无活动,不如就由你发起一场?` : '这一天暂无活动,换个日子看看,或等官方上新。'}
          </p>
        )
      )}
    </div>
  )
}
