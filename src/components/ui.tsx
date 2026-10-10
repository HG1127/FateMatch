import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Medal, X, ShieldCheck, PhoneCall, Camera } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Verification } from '@/lib/store'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import { yuanLevel } from '@/lib/badges'
import { TIER_STYLES } from '@/components/ui-constants'

export function SectionHead({ kicker, title, desc, light }: { kicker: string; title: string; desc?: string; light?: boolean }) {
  return (
    <div className="text-center mb-10 md:mb-14">
      <div className={cn('flex items-center justify-center gap-3 text-xs tracking-[.4em] mb-3', light ? 'text-gold-soft' : 'text-gold')}>
        <span className={cn('h-px w-10', light ? 'bg-gold-soft/60' : 'bg-gold/50')} />
        {kicker}
        <span className={cn('h-px w-10', light ? 'bg-gold-soft/60' : 'bg-gold/50')} />
      </div>
      <h2 className={cn('font-xing text-4xl md:text-5xl', light ? 'text-primary-foreground' : 'text-foreground')}>{title}</h2>
      {desc && <p className={cn('mt-3 text-sm md:text-base', light ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{desc}</p>}
    </div>
  )
}

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const former = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    const keydown = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
      if (dialogs[dialogs.length - 1] !== panelRef.current) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length > 0)
      if (!nodes.length) { e.preventDefault(); panelRef.current.focus(); return }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; former?.focus() }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="absolute inset-0 bg-red-ink/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="内容详情" tabIndex={-1} className={cn('relative card-cn w-full max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain rounded-t-2xl outline-none sm:max-h-[88dvh] sm:rounded-lg sm:animate-pop', wide ? 'sm:max-w-3xl' : 'sm:max-w-md')} style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <button aria-label="关闭" onClick={onClose} className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground sm:right-3 sm:top-3">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  )
}

export function MatchRing({ value, size = 56 }: { value: number; size?: number }) {
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`规则推荐参考 ${value} 分`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-xing text-primary" style={{ fontSize: size * 0.34 }}>{value}</span>
        <span className="text-[9px] text-muted-foreground">参考</span>
      </div>
    </div>
  )
}

const BADGES: Array<{ key: keyof Verification; label: string; icon: typeof ShieldCheck }> = [
  { key: 'realname', label: '实名', icon: ShieldCheck },
  { key: 'phone', label: '手机', icon: PhoneCall },
  { key: 'photo', label: '头像', icon: Camera },
]

export function VerifyBadges({ v, dim }: { v: Verification; dim?: boolean }) {
  const done = BADGES.filter(b => v[b.key]).length
  return (
    <span className="inline-flex items-center gap-1" title={`已记录 ${done}/3 项核验状态`}>
      {BADGES.map(b => {
        const Icon = b.icon
        const ok = v[b.key]
        return (
          <span
            key={b.key}
            className={cn(
              'inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-[10px] leading-none border',
              ok ? 'bg-accent/15 border-accent/50 text-gold' : dim ? 'bg-muted/40 border-border text-muted-foreground/50' : 'bg-muted border-border text-muted-foreground',
            )}
          >
            <Icon size={10} />
            {b.label}
          </span>
        )
      })}
    </span>
  )
}

export function Tag({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-11 sm:min-h-10 rounded-full border px-3 py-1.5 text-xs transition select-none',
        active ? 'bg-primary text-primary-foreground border-primary shadow-card' : 'bg-card border-border text-foreground/70 hover:border-primary/50 hover:text-primary',
      )}
    >
      {children}
    </button>
  )
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 block text-xs font-semibold tracking-wider text-foreground/70">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  )
}

const EMOJIS = ['\u{1F604}', '\u{1F602}', '\u{1F60A}', '\u{1F970}', '\u{1F97A}', '\u{1F64F}', '\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F339}', '\u{1F375}', '\u{1F319}', '\u{2728}']

/** 输入框旁的快捷表情条 */
export function EmojiRow({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="flex flex-nowrap gap-1 overflow-x-auto overscroll-x-contain pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
      {EMOJIS.map(e => (
        <button
          key={e}
          type="button"
          className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded text-base leading-none transition hover:bg-muted active:bg-primary/10 sm:h-9 sm:min-w-9"
          onClick={() => onPick(e)}
          aria-label={`表情 ${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  )
}

/** 移动端图片预览：显式关闭控件、Esc 返回、背景滚动锁定与安全区适配。 */
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!src) return
    const former = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      former?.focus()
    }
  }, [src])

  if (!src) return null
  return (
    <div role="dialog" aria-modal="true" aria-label="图片放大预览"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-red-ink/85 p-4 backdrop-blur-sm"
      onClick={onClose}>
      <button ref={closeButtonRef} type="button" aria-label="关闭图片预览"
        className="absolute right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-background/95 text-foreground shadow-lift"
        style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}
        onClick={event => { event.stopPropagation(); onClose() }}>
        <X size={22} />
      </button>
      <img src={src} alt="放大查看的图片"
        className="max-h-[86dvh] max-w-full rounded-md border border-gold/30 object-contain shadow-lift" />
      <p className="absolute text-xs text-primary-foreground/80"
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        点击空白处或关闭按钮返回
      </p>
    </div>
  )
}

/** 缘阶等级章: 缀在昵称旁, 按点亮成就数进阶, 章色随阶而变 */
export function LevelSeal({ user, gold, className }: { user: User; gold?: boolean; className?: string }) {
  const store = useStore()
  const lv = yuanLevel(store, user)
  const tier = TIER_STYLES[lv.idx] ?? TIER_STYLES[0]
  return (
    <span
      className={cn(
        'inline-block shrink-0 rounded-md px-1.5 py-0.5 text-[10px] leading-none',
        gold ? tier.dark : tier.light,
        className,
      )}
      title={`缘阶 · ${lv.name}${lv.next ? `, 再点亮 ${lv.next.min - lv.lit} 枚成就至「${lv.next.name}」` : ' · 已至最高阶'}`}
    >
      {lv.name}
    </span>
  )
}

/** 贺窗里阶名大字随阶换色, 与章色呼应 */
const TIER_TEXT = ['text-muted-foreground', 'text-primary', 'text-primary', 'text-red-ink', 'text-gold']

/** 高阶鎏金名: 莫逆起, 昵称着鎏金渐变 */
export function NickName({ user, className }: { user: User; className?: string }) {
  const store = useStore()
  const lv = yuanLevel(store, user)
  return <span className={cn('min-w-0', className, lv.idx >= 3 && 'name-gold')}>{user.nickname}</span>
}

/** 专属头像框: 莫逆得深绛环, 天成得鎏金环; 低阶无框 */
const FRAME_STYLES: Array<string | null> = [
  null,
  null,
  null,
  'bg-gradient-to-br from-primary via-red-ink to-primary',
  'bg-gradient-to-br from-gold via-gold-soft to-gold',
]

/** 缘阶专属头像框: 包住圆形头像, 阶够高才显框 */
export function AvatarFrame({ user, className, children }: { user: User; className?: string; children: ReactNode }) {
  const store = useStore()
  const lv = yuanLevel(store, user)
  const frame = FRAME_STYLES[lv.idx]
  return (
    <span
      className={cn('inline-block shrink-0 rounded-full p-[2px]', frame ?? 'bg-transparent', className)}
      title={frame ? `缘阶 · ${lv.name} 专属头像框` : undefined}
    >
      {children}
    </span>
  )
}

const CONFETTI_COLORS = [
  'hsl(var(--gold))',
  'hsl(var(--primary))',
  'hsl(var(--gold-soft))',
  'hsl(var(--accent))',
  'hsl(var(--red-ink))',
]

/** 彩纸参数在模块加载时随机定一次, 会话内保持固定, 避免渲染期取随机数 */
const CONFETTI_PIECES = Array.from({ length: 30 }, (_, i) => ({
  left: Math.random() * 100,
  delay: Math.random() * 0.7,
  dur: 1.8 + Math.random() * 1.6,
  w: 6 + Math.random() * 6,
  tilt: 240 + Math.random() * 360,
  sway: (Math.random() - 0.5) * 120,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
}))

/** 贺窗撒花: 金红彩纸自顶飘落, 纯装饰不拦交互 */
export function Confetti() {
  const pieces = CONFETTI_PIECES
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.w * 0.55,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            '--tilt': `${p.tilt}deg`,
            '--sway': `${p.sway}px`,
          } as CSSProperties}
        />
      ))}
    </div>
  )
}

/** 缘阶晋升贺窗: 全局挂一份, 自己的缘阶升上去时弹一次 */
export function LevelUpCelebration() {
  const store = useStore()
  const { me } = store
  const lv = me ? yuanLevel(store, me) : null
  const prevIdxRef = useRef<number | null>(null)
  const [rise, setRise] = useState<{ idx: number; name: string; lit: number } | null>(null)

  useEffect(() => {
    if (!lv) return
    if (prevIdxRef.current === null) {
      prevIdxRef.current = lv.idx
      return
    }
    if (lv.idx > prevIdxRef.current) setRise({ idx: lv.idx, name: lv.name, lit: lv.lit })
    prevIdxRef.current = lv.idx
  }, [lv])

  if (!rise) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-red-ink/60 p-6 backdrop-blur-sm"
      onClick={() => setRise(null)}
    >
      <Confetti />
      <div
        className="clouds-paper w-full max-w-sm animate-pop rounded-xl border border-gold/50 bg-background p-8 text-center shadow-lift"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative mx-auto h-20 w-20 animate-seal-stamp">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-gold-soft via-gold to-gold-soft shadow-[0_4px_14px_hsl(var(--red-ink)/0.4),inset_0_1px_1px_hsl(var(--primary-foreground)/0.7)]" />
          <div className="absolute inset-[4px] flex items-center justify-center rounded-full border border-gold/70 bg-gradient-to-br from-background to-gold/25 text-gold">
            <Medal size={36} />
          </div>
          <div className="pointer-events-none absolute inset-x-4 top-2 h-2.5 rounded-full bg-primary-foreground/40 blur-[2px]" />
        </div>
        <p className="mt-4 text-xs tracking-[.4em] text-gold">缘阶晋升</p>
        <p className={cn('mt-2 font-xing text-3xl', TIER_TEXT[rise.idx] ?? 'text-foreground')}>{rise.name}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          已点亮 <span className="cjk-latin">{rise.lit}</span> 枚成就,缘阶踏入「{rise.name}」。愿缘分常伴,步步进阶。
        </p>
        <button className="btn-gold mt-6 !px-6" onClick={() => setRise(null)}>
          收下此阶
        </button>
      </div>
    </div>
  )
}
