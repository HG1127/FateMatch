import { X } from 'lucide-react'
import type { WeeklyDigest } from '@/lib/store'

/** 往期合集书架: 从全部已发布期刊里挑一期翻阅 */
export function DigestArchive({ digests, onClose, onPick }: { digests: WeeklyDigest[]; onClose: () => void; onPick: (d: WeeklyDigest) => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-red-ink/60 backdrop-blur-sm md:items-center md:p-6" onClick={onClose}>
      <div
        className="clouds-paper max-h-[92vh] w-full max-w-2xl animate-fade-up overflow-y-auto rounded-t-xl border border-gold/40 bg-background p-5 shadow-lift md:rounded-xl md:p-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start gap-3">
          <span className="seal flex h-12 w-12 shrink-0 items-center justify-center font-xing text-xl">藏</span>
          <div className="min-w-0 flex-1">
            <p className="cjk-latin text-[10px] tracking-[.35em] text-gold">每周精选 · 往期合集</p>
            <h2 className="mt-0.5 font-xing text-2xl text-foreground md:text-3xl">合集藏书阁</h2>
            <p className="mt-1 text-xs text-muted-foreground">历年共编发 {digests.length} 期,挑一期翻阅吧。</p>
          </div>
          <button className="btn-ghost shrink-0 !px-2 text-muted-foreground" onClick={onClose} aria-label="关闭藏书阁">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          {digests.map((d, i) => {
            const alive = d.postIds.length
            return (
              <button
                key={d.id}
                disabled={!alive}
                onClick={() => onPick(d)}
                className="group flex w-full items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-left transition hover:border-gold/50 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-50"
              >
                {d.cover ? (
                  <img src={d.cover} alt="" className="h-14 w-24 shrink-0 rounded-md border border-gold/30 bg-secondary/40 object-contain" />
                ) : (
                  <span className="seal flex h-14 w-24 shrink-0 items-center justify-center rounded-md font-xing text-2xl">集</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="cjk-latin text-[10px] tracking-[.3em] text-gold">第 {d.issue} 期</span>
                    {i === 0 && (
                      <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">当期</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate font-xing text-lg text-foreground">{d.title}</span>
                  {d.intro && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{d.intro}</span>}
                  <span className="cjk-latin mt-1 block text-[10px] text-muted-foreground">
                    {alive ? `收录 ${alive} 篇` : '篇目已撤下'}
                    {(d.covers?.length ?? 0) > 1 && ` · ${d.covers?.length} 图封面`} · 翻阅 {d.views} 次 · {new Date(d.at).toLocaleDateString()} 编发
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
