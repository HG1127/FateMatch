import { Link } from 'react-router-dom'
import { SectionHead } from '@/components/ui'
import { useStore } from '@/lib/store'

export function Moments() {
  const { events, settings } = useStore()
  const list = events.filter(e => !settings.hiddenEvents.includes(e.id)).slice(0, 4)

  return (
    <section className="border-y border-gold/20 bg-secondary/30 py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4">
        <SectionHead kicker="线下时光" title="活动现场的模样" desc="缘不止在屏幕上,也在每一次见面里 · 点图去报名" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {list.map(e => (
            <Link key={e.id} to="/events" className="group relative overflow-hidden rounded-lg border border-border bg-card">
              <img src={e.cover} alt={e.title} className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-105" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-red-ink/85 via-red-ink/40 to-transparent p-3 pt-10">
                <p className="truncate text-sm text-primary-foreground">{e.title}</p>
                <p className="cjk-latin mt-0.5 text-[11px] text-primary-foreground/70">{e.city} · {e.date}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
