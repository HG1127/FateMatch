import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Hourglass, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { isProfileReadyForMatching, useStore } from '@/lib/store'
import type { User } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { YuanfenCard } from '@/components/yuanfen/YuanfenCard'
import { MatchModal } from '@/components/MatchModal'

export function YuanfenPage() {
  const { dailyYuanfen, like, unlike, pass, unpass, markTour, matchScore, me, match } = useStore()
  // 今日三位有缘人进页即锁定, 掠过/有意不改变名单, 可自由前后翻看
  const [list] = useState(() => dailyYuanfen())
  const [idx, setIdx] = useState(0)
  const [matched, setMatched] = useState<User | null>(null)
  const touchX = useRef<number | null>(null)
  const acted = new Set([...(match.likes[me?.id ?? ''] ?? []), ...(match.passes[me?.id ?? ''] ?? [])])
  const [sortByMatch, setSortByMatch] = useState(() => {
    try {
      return localStorage.getItem('sy_yuanfen_sort') === 'match'
    } catch {
      return false
    }
  })
  const order = useMemo(
    () => (sortByMatch ? [...list].sort((a, b) => matchScore(b) - matchScore(a)) : list),
    [list, sortByMatch, matchScore],
  )

  const best = useMemo(
    () => (list.length ? [...list].sort((a, b) => matchScore(b) - matchScore(a))[0] : null),
    [list, matchScore],
  )
  const profileReady = !!me && isProfileReadyForMatching(me)

  useEffect(() => {
    markTour('yuanfen')
  }, [])

  // 键盘左右方向键翻看, 输入框聚焦时不响应
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1))
      else if (e.key === 'ArrowRight') setIdx(i => Math.min(Math.max(list.length - 1, 0), i + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list.length])
  const now = new Date()
  const dateStr = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`
  const current = order[idx]

  const next = () => setIdx(i => i + 1)

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">随缘分配</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">今日随缘</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {dateStr} · 缘不贪多,今日为你甄选 <span className="cjk-latin font-semibold text-primary">{list.length}</span> 位有缘人
        </p>
        <button
          className="mt-3 rounded-full border border-border px-3 py-1 text-[11px] text-foreground/70 transition hover:border-gold/60 hover:text-gold"
          onClick={() => {
            const nv = !sortByMatch
            setSortByMatch(nv)
            setIdx(0)
            try {
              localStorage.setItem('sy_yuanfen_sort', nv ? 'match' : 'fate')
            } catch {
              /* 记不下便随它 */
            }
          }}
        >
          {sortByMatch ? '按契合度排列中 · 点一下回到随缘序' : '按随缘序排列中 · 点一下改按契合度'}
        </button>
      </div>

      {best && (
        <div className="card-cn mb-8 flex items-center gap-4 rounded-lg !border-gold/50 p-4">
          <img src={best.photos[0]} alt={best.nickname} className="h-16 w-16 shrink-0 rounded-full border-2 border-gold/60 object-cover" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
              <span className="inline-flex items-center gap-1 rounded-sm bg-gold px-1.5 py-0.5 text-[10px] text-accent-foreground">
                <Sparkles size={10} />
                今日最契合
              </span>
              {best.nickname}
              <span className="cjk-latin text-gold">{matchScore(best)}% 契合</span>
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {best.job} · {regionOf(best)}
              {me && best.interests.some(t => me.interests.includes(t)) && (
                <> · 同好「{best.interests.filter(t => me.interests.includes(t)).slice(0, 2).join('、')}」</>
              )}
            </p>
          </div>
          <button
            className="btn-gold shrink-0 !px-4 !py-2 text-xs transition hover:shadow-lift active:scale-95"
            onClick={() => {
              const bestIndex = order.findIndex(u => u.id === best.id)
              if (bestIndex >= 0) setIdx(bestIndex)
            }}
          >
            看这位
          </button>
        </div>
      )}

      {current ? (
        <>
          <div
            onTouchStart={e => (touchX.current = e.touches[0].clientX)}
            onTouchEnd={e => {
              if (touchX.current == null) return
              const dx = e.changedTouches[0].clientX - touchX.current
              if (Math.abs(dx) > 48) {
                if (dx < 0) setIdx(i => Math.min(Math.max(list.length - 1, 0), i + 1))
                else setIdx(i => Math.max(0, i - 1))
              }
              touchX.current = null
            }}
          >
            <YuanfenCard
              key={current.id}
              user={current}
              onPass={() => {
                pass(current.id)
                toast('已掠过此缘,下一位')
                next()
              }}
              onLike={() => {
                const back = like(current.id)
                if (back) {
                  setMatched(current)
                } else {
                  toast('已道「有意」,若对方亦有意,将送往你的佳音')
                }
                next()
              }}
              onUnlike={() => {
                unlike(current.id)
                toast('已撤回这份「有意」')
              }}
              onUnpass={() => {
                unpass(current.id)
                toast('已收回「且过」,此缘复还')
              }}
            />
          </div>
          <div className="mt-6 flex flex-col items-center gap-2.5">
            <div className="flex items-center gap-3">
              <button
                className="btn-outline !px-3 !py-1.5 text-xs disabled:opacity-40"
                disabled={idx === 0}
                onClick={() => setIdx(i => Math.max(0, i - 1))}
              >
                <ChevronLeft size={14} />
                上一位
              </button>
              <p className="cjk-latin text-[11px] text-muted-foreground">第 {Math.min(idx + 1, list.length)} / {list.length} 位</p>
              <button
                className="btn-outline !px-3 !py-1.5 text-xs disabled:opacity-40"
                disabled={idx >= list.length - 1}
                onClick={() => setIdx(i => Math.min(list.length - 1, i + 1))}
              >
                下一位
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="flex justify-center gap-2">
              {order.map((u, i) => (
                <button
                  key={u.id}
                  aria-label={`看第 ${i + 1} 位`}
                  onClick={() => setIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-8 bg-primary' : acted.has(u.id) ? 'w-4 bg-gold/60 hover:bg-gold' : 'w-4 bg-border hover:bg-gold/40'}`}
                />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">前后翻看不动缘分,「且过」「有意」才记态度。</p>
          </div>
        </>
      ) : (
        <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center">
          <span className="seal mx-auto flex h-14 w-14 font-xing text-2xl">缘</span>
          <h3 className="mt-4 font-xing text-2xl text-foreground">{profileReady ? '暂时没有符合条件的缘分' : '先确认必要资料'}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {profileReady
              ? '当前推荐池没有满足双方必要条件的人。你可以稍后再来，或调整自己的真实资料。'
              : '确认性别、希望认识的对象、出生日期与所在城市后，才会进入真人推荐。'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/me" className="btn-primary">{profileReady ? '检查我的资料' : '去完善资料'}</Link>
            {profileReady && <Link to="/matches" className="btn-outline">查看佳音</Link>}
          </div>
        </div>
      )}

      <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Hourglass size={12} />
        推荐只展示满足当前必要条件的真人候选 · 双方真实「有意」才结为佳音
      </p>

      <MatchModal user={matched} open={!!matched} onClose={() => setMatched(null)} />
    </div>
  )
}
