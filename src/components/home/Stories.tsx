import { useStore } from '@/lib/store'
import { SectionHead } from '@/components/ui'

export function Stories() {
  const { settings } = useStore()
  const stories = settings.stories.filter(s => s.names || s.quote)
  if (!stories.length) return null

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
      <SectionHead kicker="佳音墙" title="他们在这里遇见了缘" desc="来自会员的真实回执,愿下一封佳音属于你" />
      <div className="grid gap-6 md:grid-cols-3">
        {stories.map((s, i) => (
          <figure key={`${s.names}-${i}`} className="card-cn relative rounded-lg p-5">
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
