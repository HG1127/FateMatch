import { useEffect, useRef, useState } from 'react'
import { Lock, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import { buildBadges, yuanLevel, LEVEL_TIERS, type BadgeDef } from '@/lib/badges'
import { Confetti } from '@/components/ui'
import { cn } from '@/lib/utils'
import { TIER_STYLES } from '@/components/ui-constants'

/** 获得日期: 2026·09·04 */
const fmtDate = (t?: number) => {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}·${String(d.getMonth() + 1).padStart(2, '0')}·${String(d.getDate()).padStart(2, '0')}`
}

export function BadgesPage() {
  const store = useStore()
  const { me, saveProfile } = store
  const [tab, setTab] = useState<'all' | 'done' | 'todo'>('all')
  const [byDate, setByDate] = useState(false)
  const [celebrate, setCelebrate] = useState<BadgeDef | null>(null)
  const seenRef = useRef<Set<string> | null>(null)
  const badges = me ? buildBadges(me, store) : []
  const doneKey = badges.filter(b => b.cur >= b.target).map(b => b.id).join(',')
  // 停留本页期间新点亮的勋章, 当场开一扇贺窗
  useEffect(() => {
    if (!doneKey) return
    const ids = doneKey.split(',')
    if (seenRef.current === null) {
      seenRef.current = new Set(ids)
      return
    }
    const fresh = ids.filter(id => !seenRef.current!.has(id))
    if (!fresh.length) return
    fresh.forEach(id => seenRef.current!.add(id))
    const b = badges.find(x => x.id === fresh[0])
    if (b) setCelebrate(b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey])
  // 点亮即落款: 首见尚无时间戳的已点亮勋章, 补记获得时间
  useEffect(() => {
    if (!me) return
    const missing = badges.filter(b => b.cur >= b.target && !me.badgeDates?.[b.id])
    if (!missing.length) return
    const next = { ...(me.badgeDates ?? {}) }
    const now = Date.now()
    missing.forEach(b => { next[b.id] = now })
    void saveProfile({ badgeDates: next }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey, me?.id])
  if (!me) return null

  const lv = yuanLevel(store, me)
  const lvPct = lv.next ? Math.min(100, (lv.lit / lv.next.min) * 100) : 100
  const unlocked = badges.filter(b => b.cur >= b.target).length
  const base = tab === 'all' ? badges : badges.filter(b => (b.cur >= b.target) === (tab === 'done'))
  // 按获得时间: 已点亮的依落款先后排(最早在前, 如集章册), 未点亮的殿后
  const shown = byDate
    ? [
        ...base.filter(b => b.cur >= b.target).sort((a, b) => (me.badgeDates?.[a.id] ?? 0) - (me.badgeDates?.[b.id] ?? 0)),
        ...base.filter(b => b.cur < b.target),
      ]
    : base
  const shareBadges = async () => {
    const litSorted = [...badges.filter(b => b.cur >= b.target)].sort((a, b) => (me.badgeDates?.[a.id] ?? 0) - (me.badgeDates?.[b.id] ?? 0))
    const lines = [
      '随缘网 · 缘分成就',
      `当前缘阶 ${lv.name} · 已点亮 ${unlocked}/${badges.length} 枚勋章`,
      litSorted.length ? `点亮:${litSorted.map(b => `${b.name}${me.badgeDates?.[b.id] ? `(${fmtDate(me.badgeDates[b.id])})` : ''}`).join('、')}` : '第一枚勋章正在路上',
      '—— 随缘网 · 一切相遇皆是缘',
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success('成就卡已复制,快去分享给有缘人')
    } catch {
      toast.error('复制失败,换个浏览器试试')
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-xs tracking-[.3em] text-muted-foreground">缘分成就</p>
          <h1 className="mt-1 font-xing text-4xl text-foreground">一路缘迹,皆成勋章</h1>
          <p className="mt-2 text-sm text-muted-foreground">每一次真诚的靠近,都值得被记住。</p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">带「缘阶」标记的勋章按阶进阶,点亮一阶,再攀下一阶。</p>
        </div>
        <div className="text-right">
          <p className="font-xing text-4xl text-primary">
            <span className="cjk-latin">{unlocked}</span> / <span className="cjk-latin">{badges.length}</span>
          </p>
          <p className="mt-1 text-xs tracking-widest text-muted-foreground">已点亮</p>
          <button className="btn-outline mt-2 !px-3 !py-1.5 text-[11px]" onClick={() => void shareBadges()}>
            <Share2 size={12} />
            晒晒成就
          </button>
        </div>
      </div>

      {/* 缘阶进度: 当前所处之阶与下一阶的距离 */}
      <div className="card-cn mb-6 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2.5 text-sm text-foreground">
            <span className={cn('rounded-md px-2.5 py-1 text-xs leading-none', TIER_STYLES[lv.idx]?.light)}>{lv.name}</span>
            当前缘阶
            <span className="cjk-latin text-xs text-muted-foreground">已点亮 {lv.lit} 枚成就</span>
          </p>
          {lv.next ? (
            <p className="text-[11px] text-muted-foreground">
              再点亮 <span className="cjk-latin">{lv.next.min - lv.lit}</span> 枚, 晋「{lv.next.name}」
            </p>
          ) : (
            <p className="text-[11px] text-gold">已至最高阶 · 天成</p>
          )}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-gradient-to-r from-gold to-primary transition-all duration-500" style={{ width: `${lvPct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {LEVEL_TIERS.map((t, i) => (
            <span
              key={t.name}
              className={cn('rounded-md px-2 py-0.5 text-[10px] leading-none', TIER_STYLES[i]?.light, i === lv.idx && 'ring-1 ring-gold')}
              title={i === lv.idx ? '你所在的缘阶' : `${t.name} · 点亮 ${t.min} 枚成就`}
            >
              {t.name}
            </span>
          ))}
        </div>
        <p className="mt-2.5 text-[10px] text-muted-foreground">
          缘至「莫逆」得深绛头像框与鎏金名,至「天成」得鎏金头像框,全站头像与昵称处皆可见。
        </p>
      </div>

      <div className="mb-3 flex justify-center gap-2">
        {([['all', `全部 ${badges.length}`], ['done', `已点亮 ${unlocked}`], ['todo', `待点亮 ${badges.length - unlocked}`]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn('rounded-full border px-4 py-1.5 text-sm transition', tab === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex justify-center">
        <button
          type="button"
          onClick={() => setByDate(v => !v)}
          title="已点亮的勋章按落款先后排列, 最早在前, 如一本集章册"
          className={cn(
            'rounded-full border px-3 py-1 text-[11px] transition',
            byDate ? 'border-gold bg-gold/10 text-gold' : 'border-border text-muted-foreground hover:border-gold/50 hover:text-foreground',
          )}
        >
          {byDate ? '按获得时间排 · 最早在前' : '按获得时间排'}
        </button>
      </div>

      {shown.length ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {shown.map(b => {
          const done = b.cur >= b.target
          const Icon = b.icon
          return (
            <div
              key={b.id}
              className={cn(
                'card-cn relative rounded-lg p-5 text-center transition',
                done ? 'border-gold/50 shadow-card hover:-translate-y-0.5 hover:shadow-lift' : 'opacity-90',
              )}
            >
              {done ? (
                /* 金属质奖章: 鎏金外环 + 内嵌浮雕 + 顶部高光 */
                <div className="relative mx-auto h-16 w-16 animate-seal-stamp">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-gold-soft via-gold to-gold-soft shadow-[0_3px_10px_hsl(var(--red-ink)/0.35),inset_0_1px_1px_hsl(var(--primary-foreground)/0.7)]" />
                  <div className="absolute inset-[3px] flex items-center justify-center rounded-full border border-gold/70 bg-gradient-to-br from-background via-background to-gold/25 text-gold shadow-[inset_0_1px_3px_hsl(var(--red-ink)/0.2)]">
                    <Icon size={24} />
                  </div>
                  <div className="pointer-events-none absolute inset-x-3 top-1.5 h-2 rounded-full bg-primary-foreground/40 blur-[1.5px]" />
                </div>
              ) : (
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-border bg-secondary/60 text-muted-foreground/50 shadow-[inset_0_2px_5px_hsl(var(--red-ink)/0.08)]">
                  <Icon size={22} />
                </div>
              )}
              {b.stage && <p className="mt-2.5 text-[10px] tracking-[.2em] text-gold/80">{b.stage}</p>}
              <p className={cn(b.stage ? 'mt-0.5' : 'mt-3', 'font-xing text-xl', done ? 'text-primary' : 'text-foreground/70')}>{b.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{b.desc}</p>
              {done ? (
                <div className="mt-3 space-y-1.5">
                  <span className="seal inline-block px-2 py-0.5 text-[10px]">已点亮</span>
                  <p className="cjk-latin text-[10px] tracking-wider text-muted-foreground">得于 {fmtDate(me.badgeDates?.[b.id]) || '早前'}</p>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="mx-auto h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary/50" style={{ width: `${Math.min(100, (b.cur / b.target) * 100)}%` }} />
                  </div>
                  <p className="cjk-latin mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Lock size={9} />
                    {Math.min(b.cur, b.target)} / {b.target}
                  </p>
                </div>
              )}
            </div>
          )
        })}
        </div>
      ) : (
        <p className="rounded-md bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
          {tab === 'done' ? '还没有点亮的勋章,先去完成一个小目标吧。' : '所有勋章都已点亮,缘路圆满!'}
        </p>
      )}

      {celebrate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-red-ink/60 p-6 backdrop-blur-sm"
          onClick={() => setCelebrate(null)}
        >
          <Confetti />
          <div
            className="clouds-paper w-full max-w-sm animate-pop rounded-xl border border-gold/50 bg-background p-8 text-center shadow-lift"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative mx-auto h-20 w-20 animate-seal-stamp">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-gold-soft via-gold to-gold-soft shadow-[0_4px_14px_hsl(var(--red-ink)/0.4),inset_0_1px_1px_hsl(var(--primary-foreground)/0.7)]" />
              <div className="absolute inset-[4px] flex items-center justify-center rounded-full border border-gold/70 bg-gradient-to-br from-background to-gold/25 text-gold">
                <celebrate.icon size={36} />
              </div>
              <div className="pointer-events-none absolute inset-x-4 top-2 h-2.5 rounded-full bg-primary-foreground/40 blur-[2px]" />
            </div>
            <p className="mt-4 text-xs tracking-[.4em] text-gold">勋章点亮</p>
            <p className="mt-2 font-xing text-3xl text-foreground">{celebrate.name}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{celebrate.desc}</p>
            <button className="btn-gold mt-6 !px-6" onClick={() => setCelebrate(null)}>
              收下这份缘
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
