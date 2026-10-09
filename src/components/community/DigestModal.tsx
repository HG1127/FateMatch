import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Share2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { Post, User, WeeklyDigest } from '@/lib/store'
import { PostTile } from '@/components/community/PostTile'
import { PostDialog } from '@/components/community/PostDialog'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { cn } from '@/lib/utils'

/** 每周精选合集阅读器: 按主编选定的顺序逐篇浏览 */
export function DigestModal({ digest, posts, onClose }: { digest: WeeklyDigest | null; posts: Post[]; onClose: () => void }) {
  const { users, markTour } = useStore()
  const [detailId, setDetailId] = useState('')
  const [profile, setProfile] = useState<User | null>(null)
  const [coverIdx, setCoverIdx] = useState(0)
  const [coverHover, setCoverHover] = useState(false)
  const touchX = useRef<number | null>(null)
  const allCovers = digest?.covers?.length ? digest.covers : digest?.cover ? [digest.cover] : []
  // 切换合集时封面回到第一张: 渲染期调整 state, 免 effect 级联渲染
  const [seenDigestId, setSeenDigestId] = useState(digest?.id)
  if (digest?.id !== seenDigestId) {
    setSeenDigestId(digest?.id)
    setCoverIdx(0)
  }
  // 翻开合集即记一笔, 供新人任务「翻阅一辑每周精选」(markTour 幂等, 重复调用无副作用)
  useEffect(() => {
    if (digest) void markTour('digest').catch(() => {})
  }, [digest, markTour])
  // 多封面自动轮播, 鼠标悬停时暂停
  useEffect(() => {
    if (allCovers.length < 2 || coverHover) return
    const t = setInterval(() => setCoverIdx(i => (i + 1) % allCovers.length), 4000)
    return () => clearInterval(t)
  }, [allCovers.length, coverHover, digest?.id])
  if (!digest) return null
  const detail = posts.find(p => p.id === detailId) ?? null
  const share = async () => {
    const parts: string[] = [`随缘网 · 每周精选 第${digest.issue}期「${digest.title}」`]
    if (digest.intro) parts.push(digest.intro)
    parts.push('')
    parts.push(
      ...posts.map((p, i) => {
        const author = users.find(u => u.id === p.authorId)
        const snippet = p.text.length > 24 ? `${p.text.slice(0, 24)}…` : p.text
        return `${i + 1}. ${author?.nickname ?? '佚名'}:${snippet}`
      }),
    )
    parts.push('', '—— 全文尽在随缘网社区,随缘而遇')
    try {
      await navigator.clipboard.writeText(parts.join('\n'))
      toast.success('合集卡片已复制,快去分享给有缘人')
    } catch {
      toast.error('复制失败,换个浏览器试试')
    }
  }
  return (
    <>
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-red-ink/60 backdrop-blur-sm md:items-center md:p-6" onClick={onClose}>
        <div
          className="clouds-paper max-h-[92vh] w-full max-w-3xl animate-fade-up overflow-y-auto rounded-t-xl border border-gold/40 bg-background p-5 shadow-lift md:rounded-xl md:p-8"
          onClick={e => e.stopPropagation()}
        >
          <div className="mb-5 flex items-start gap-3">
            <span className="seal flex h-12 w-12 shrink-0 items-center justify-center font-xing text-xl">精</span>
            <div className="min-w-0 flex-1">
              <p className="cjk-latin text-[10px] tracking-[.35em] text-gold">每周精选 · 第 {digest.issue} 期</p>
              <h2 className="mt-0.5 font-xing text-2xl text-foreground md:text-3xl">{digest.title}</h2>
              {digest.intro && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{digest.intro}</p>}
            </div>
            <button className="btn-ghost shrink-0 !px-2 text-muted-foreground" onClick={() => void share()} aria-label="分享合集">
              <Share2 size={15} />
            </button>
            <button className="btn-ghost shrink-0 !px-2 text-muted-foreground" onClick={onClose} aria-label="关闭合集">
              <X size={16} />
            </button>
          </div>
          {allCovers.length > 0 && (
            <div
              className="relative mb-5"
              onMouseEnter={() => setCoverHover(true)}
              onMouseLeave={() => setCoverHover(false)}
              onTouchStart={e => (touchX.current = e.touches[0].clientX)}
              onTouchEnd={e => {
                if (touchX.current == null) return
                const dx = e.changedTouches[0].clientX - touchX.current
                if (Math.abs(dx) > 40 && allCovers.length > 1) {
                  setCoverIdx(i => (i + (dx < 0 ? 1 : allCovers.length - 1)) % allCovers.length)
                }
                touchX.current = null
              }}
            >
              <img
                key={coverIdx}
                src={allCovers[Math.min(coverIdx, allCovers.length - 1)]}
                alt=""
                className="max-h-80 w-full animate-fade-in rounded-lg border border-gold/30 bg-secondary/40 object-contain"
              />
              {allCovers.length > 1 && (
                <>
                  <button
                    aria-label="上一张封面"
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-red-ink/50 p-1.5 text-primary-foreground transition hover:bg-red-ink/75"
                    onClick={() => setCoverIdx(i => (i - 1 + allCovers.length) % allCovers.length)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    aria-label="下一张封面"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-red-ink/50 p-1.5 text-primary-foreground transition hover:bg-red-ink/75"
                    onClick={() => setCoverIdx(i => (i + 1) % allCovers.length)}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                    {allCovers.map((_, i) => (
                      <button
                        key={i}
                        aria-label={`第 ${i + 1} 张封面`}
                        onClick={() => setCoverIdx(i)}
                        className={cn('h-1.5 rounded-full transition-all', i === coverIdx ? 'w-4 bg-gold' : 'w-1.5 bg-card/70 hover:bg-card')}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {posts.length ? (
            <div className="grid gap-4 sm:grid-cols-2 [&_article]:mb-0">
              {posts.map(p => (
                <PostTile key={p.id} post={p} onOpen={x => setDetailId(x.id)} onProfile={setProfile} />
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-secondary/40 p-8 text-center text-sm text-muted-foreground">这期合集的帖文已被作者撤下,换一期看看吧。</p>
          )}
          <p className="cjk-latin mt-4 text-center text-[10px] text-muted-foreground">
            共收录 {posts.length} 篇 · {new Date(digest.at).toLocaleDateString()} 编发 · 已被翻阅 {digest.views} 次
          </p>
        </div>
      </div>
      <PostDialog post={detail} onClose={() => setDetailId('')} />
      <DetailDialog user={profile} onClose={() => setProfile(null)} />
    </>
  )
}
