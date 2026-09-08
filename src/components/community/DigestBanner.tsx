import { BookMarked } from 'lucide-react'
import type { WeeklyDigest } from '@/lib/store'
import { cn } from '@/lib/utils'

/** 每周精选合集的门面横幅: 社区门口与首页共用 */
export function DigestBanner({ digest, count, onOpen }: { digest: WeeklyDigest; count: number; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group relative block w-full overflow-hidden rounded-lg border border-gold/50 bg-gradient-to-r from-red-ink via-primary to-red-ink p-5 text-left text-primary-foreground transition hover:shadow-lift"
    >
      <span className="pointer-events-none absolute -right-4 -top-8 select-none font-xing text-[7rem] leading-none text-gold-soft/15">集</span>
      <span className="flex items-center gap-2">
        <span className="seal flex h-9 w-9 shrink-0 items-center justify-center font-xing text-lg">精</span>
        <span className="min-w-0">
          <span className="cjk-latin block text-[10px] tracking-[.35em] text-gold">每周精选 · 第 {digest.issue} 期</span>
          <span className="mt-0.5 block truncate font-xing text-2xl">{digest.title}</span>
        </span>
        {digest.cover && (
          <img
            src={digest.cover}
            alt=""
            className="ml-auto hidden h-16 w-28 shrink-0 rounded-md border border-gold/50 bg-red-ink/30 object-contain shadow-card sm:block"
          />
        )}
        <span
          className={cn(
            'hidden shrink-0 items-center gap-1.5 rounded-full border border-gold/50 bg-gold/15 px-3 py-1.5 text-xs text-gold transition group-hover:bg-gold/25 sm:inline-flex',
            !digest.cover && 'ml-auto',
          )}
        >
          <BookMarked size={13} />
          翻阅本期 {count} 篇
        </span>
      </span>
      {digest.intro && <span className="mt-2.5 block line-clamp-2 text-xs leading-relaxed text-primary-foreground/80">{digest.intro}</span>}
      <span className="mt-2 block text-xs text-gold sm:hidden">翻阅本期 {count} 篇 →</span>
    </button>
  )
}
