import { useStore } from '@/lib/store-context'
import { SectionHead } from '@/components/ui'

export function Stories() {
  const { settings } = useStore()
  const stories = settings.stories.filter(s => s.names || s.quote)
  if (!stories.length) return null

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
      <SectionHead kicker="佳音墙" title="相遇故事示例" desc="当前内容为版式示例,不代表真实会员反馈；真实故事仅在获得授权并可核实后展示" />
      <div className="grid gap-6 md:grid-cols-3">
        {stories.map((s, i) => (
          <figure key={`${s.names}-${i}`} className="card-cn relative rounded-lg p-5">
            <span className="absolute left-4 top-4 z-10 rounded-full bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-card">示例</span>
            <span className="seal absolute right-4 top-4 z-10 px-1.5 py-1 font-xing text-sm">囍</span>
            {s.img && <img src={s.img} alt={s.names} className="mb-4 aspect-[4/3] w-full rounded-md border border-border object-cover" />}
            <blockquote className="text-sm leading-relaxed text-foreground/85">「{s.quote}」</blockquote>
            <figcaption className="mt-4 border-t border-border pt-3">
              <p className="font-xing text-lg text-primary">{s.names}</p>
              <p className="text-xs text-muted-foreground">{s.city}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
