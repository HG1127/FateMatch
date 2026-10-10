import { useEffect, useRef, type RefObject } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronRight, ShieldCheck, Settings, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MenuEntry {
  to: string
  label: string
  desc: string
}

interface MobileMoreMenuProps {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  items: MenuEntry[]
  isAdmin: boolean
  isMember: boolean
}

/** Small-screen discovery sheet for features outside the four core bottom tabs. */
export function MobileMoreMenu({ open, onClose, triggerRef, items, isAdmin, isMember }: MobileMoreMenuProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const originalOverflow = document.body.style.overflow
    const trigger = triggerRef.current
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
        .filter(element => element.getClientRects().length > 0)
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = originalOverflow
      trigger?.focus()
    }
  }, [open, triggerRef])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:hidden">
      <button
        type="button"
        className="absolute inset-0 w-full bg-red-ink/55 backdrop-blur-[2px]"
        aria-label="关闭更多功能"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-more-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg overflow-y-auto rounded-t-[24px] border border-gold/30 bg-background px-4 pt-4 shadow-lift outline-none"
        style={{ maxHeight: 'min(86dvh, 720px)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 id="mobile-more-title" className="font-xing text-2xl text-foreground">发现更多</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">按需要探索随缘网的其他功能</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭更多功能菜单"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-foreground">
            <X size={20} />
          </button>
        </div>
        <nav aria-label="手机更多功能" className="grid grid-cols-2 gap-2">
          {(isMember ? items : [
            { to: '/auth?mode=register', label: '加入随缘网', desc: '创建自己的账号' },
            { to: '/trust', label: '安全与隐私', desc: '了解使用与隐私规则' },
          ]).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) => cn(
                'group flex min-h-[92px] flex-col justify-between rounded-xl border bg-card p-3 transition active:scale-[.98]',
                isActive ? 'border-primary/50 bg-primary/5' : 'border-border',
              )}
            >
              <span className="flex items-center justify-between gap-1 text-sm font-semibold text-foreground">
                {item.label}
                <ChevronRight size={16} className="shrink-0 text-primary/70" />
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{item.desc}</span>
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/admin" onClick={onClose}
              className="flex min-h-[64px] items-center justify-between gap-2 rounded-xl border border-gold/40 bg-gold/5 p-3 text-sm font-semibold text-foreground">
              <span className="flex items-center gap-2"><Settings size={18} />系统设置</span><ChevronRight size={16} />
            </NavLink>
          )}
        </nav>
        {isMember && (
          <NavLink to="/trust" onClick={onClose}
            className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-secondary/40 text-sm text-foreground/80">
            <ShieldCheck size={17} /> 安全与隐私说明
          </NavLink>
        )}
      </section>
    </div>
  )
}
