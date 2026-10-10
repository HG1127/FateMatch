import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarHeart, ChevronDown, Menu, MessageCircleHeart, Sparkles, UserRound } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import type { FeatureKey } from '@/lib/store'
import { cn } from '@/lib/utils'
import { LocalAccountMenu } from '@/components/local/LocalAccountMenu'
import { MobileMoreMenu } from '@/components/MobileMoreMenu'
import { AvatarFrame, LevelSeal, LevelUpCelebration, NickName } from '@/components/ui'

const MEMBER_NAV: Array<{ to: string; label: string; feat?: FeatureKey }> = [
  { to: '/', label: '推荐' },
  { to: '/events', label: '活动', feat: 'events' },
  { to: '/matches', label: '消息', feat: 'matches' },
  { to: '/me', label: '我的' },
]

const GUEST_NAV: Array<{ to: string; label: string; feat?: FeatureKey }> = [
  { to: '/', label: '首页' },
  { to: '/trust', label: '安全与隐私' },
]

/** 移动端仅保留四个最高频任务入口。 */
const MOBILE_TABS: Array<{ to: string; label: string; icon: typeof Sparkles; feat?: FeatureKey }> = [
  { to: '/', label: '推荐', icon: Sparkles },
  { to: '/events', label: '活动', icon: CalendarHeart, feat: 'events' },
  { to: '/matches', label: '消息', icon: MessageCircleHeart, feat: 'matches' },
  { to: '/me', label: '我的', icon: UserRound },
]

/** 低频能力不再争夺主导航，功能仍完整保留。 */
const MORE = [
  { to: '/yuanfen', label: '今日精选', desc: '每天少量、可解释的推荐' },
  { to: '/explore', label: '兴趣筛选', desc: '按城市与兴趣主动探索' },
  { to: '/nearby', label: '同城', desc: '按城市与地区寻找' },
  { to: '/community', label: '生活分享', desc: '从真实生活内容了解彼此' },
  { to: '/favorites', label: '我的收藏', desc: '想继续了解的人与活动' },
  { to: '/report', label: '缘分周报', desc: '一周关系进展回顾' },
  { to: '/badges', label: '成长记录', desc: '辅助记录，不代表人格信用' },
]

export function MoreDropdown() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const active = MORE.some(m => pathname === m.to)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerTypeRef = useRef('mouse')
  const panelId = useId()

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }
  const closeMenu = () => {
    cancelClose()
    setOpen(false)
  }
  const scheduleClose = () => {
    cancelClose()
    // A short grace period tolerates diagonal mouse movement without flicker.
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 180)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  return (
    <div
      ref={dropdownRef}
      className="relative"
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'relative flex items-center gap-0.5 rounded-md px-3 py-2 text-sm transition',
          active || open ? 'font-semibold text-primary' : 'text-foreground/70 hover:bg-muted hover:text-foreground',
        )}
        onMouseEnter={() => {
          cancelClose()
          setOpen(true)
        }}
        onPointerDown={event => { pointerTypeRef.current = event.pointerType }}
        onClick={event => {
          cancelClose()
          // Mouse hover opens the menu; clicking should not immediately close it.
          // Touch and keyboard activations still toggle it explicitly.
          if (event.detail === 0 || pointerTypeRef.current !== 'mouse') {
            setOpen(value => !value)
          } else {
            setOpen(true)
          }
        }}
        onKeyDown={event => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          cancelClose()
          setOpen(true)
          window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus())
        }}
      >
        更多
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        /* The padding on this non-animated wrapper bridges the trigger/menu gap. */
        <div id={panelId} className="absolute right-0 top-full z-50 w-52 pt-1">
          <nav ref={panelRef} aria-label="更多导航" className="card-cn animate-dropdown-in rounded-lg p-1.5 shadow-lift">
            {MORE.map((m, i) => (
              <NavLink
                key={m.to}
                to={m.to}
                onClick={closeMenu}
                style={{ animationDelay: `${40 + i * 45}ms` }}
                className={({ isActive }) =>
                  cn(
                    'dropdown-item-in block rounded-md px-3 py-2 transition',
                    isActive ? 'bg-primary/10' : 'hover:bg-muted',
                  )
                }
              >
                <span className={cn('block text-sm', pathname === m.to ? 'font-semibold text-primary' : 'text-foreground')}>{m.label}</span>
                <span className="block text-[10px] text-muted-foreground">{m.desc}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const { me, dataReady, conversations, unread, featureOn, refreshChatSummaries } = useStore()
  const { pathname, search } = useLocation()
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const [editingField, setEditingField] = useState(false)
  const chatTargetId = new URLSearchParams(search).get('with')
  const chatOpenOnMobile = pathname === '/matches' && !!me && !!chatTargetId && conversations().some(c => c.user.id === chatTargetId)

  // The soft keyboard must not fight the fixed bottom navigation for screen space.
  useEffect(() => {
    let pending: number | undefined
    const syncEditing = () => {
      const el = document.activeElement
      setEditingField(el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ||
        (el instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button', 'submit', 'hidden'].includes(el.type)))
    }
    const blur = () => { pending = window.setTimeout(syncEditing, 50) }
    document.addEventListener('focusin', syncEditing)
    document.addEventListener('focusout', blur)
    return () => {
      document.removeEventListener('focusin', syncEditing)
      document.removeEventListener('focusout', blur)
      if (pending) window.clearTimeout(pending)
    }
  }, [])

  const refreshRef = useRef(refreshChatSummaries)
  useEffect(() => { refreshRef.current = refreshChatSummaries }, [refreshChatSummaries])
  useEffect(() => {
    if (!me?.id || !dataReady) return
    let lastRun = 0
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRun < 10_000) return
      lastRun = Date.now()
      void refreshRef.current().catch(() => {})
    }
    const timer = window.setInterval(refresh, 45_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [me?.id, dataReady])
  const mutualCount = me ? conversations().reduce((s, c) => s + unread(c.user.id), 0) : 0
  const items = (me ? MEMBER_NAV : GUEST_NAV).filter(n => !n.feat || featureOn(n.feat))
  const isAdmin = me?.role === 'admin'

  return (
    <div className="flex min-h-screen min-h-[100dvh] min-w-0 flex-col">
      <header className="sticky top-0 z-40 border-b border-gold/25 bg-background/95 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="lattice" />
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:h-16 sm:px-4 md:gap-4">
          <Link to="/" className="flex min-w-0 items-center gap-2 sm:gap-2.5" aria-label="随缘网首页">
            <span className="seal h-8 w-8 shrink-0 font-xing text-lg sm:h-9 sm:w-9 sm:text-xl">缘</span>
            <span className="min-w-0 leading-tight">
              <span className="block whitespace-nowrap font-xing text-xl text-primary sm:text-2xl">随缘网</span>
              <span className="hidden text-[10px] tracking-[.3em] text-muted-foreground sm:block">一切相遇皆是缘</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {items.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'relative rounded-md px-3 py-2 text-sm transition after:absolute after:inset-x-3 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-primary after:transition-opacity',
                    isActive
                      ? 'font-semibold text-primary after:opacity-100'
                      : 'text-foreground/70 hover:bg-muted hover:text-foreground after:opacity-0',
                  )
                }
              >
                {n.label}
                {n.to === '/matches' && mutualCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                    {mutualCount}
                  </span>
                )}
              </NavLink>
            ))}
            {me && <MoreDropdown />}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    'relative rounded-md px-3 py-2 text-sm transition after:absolute after:inset-x-3 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-primary after:transition-opacity',
                    isActive
                      ? 'font-semibold text-primary after:opacity-100'
                      : 'text-foreground/70 hover:bg-muted hover:text-foreground after:opacity-0',
                  )
                }
              >
                系统设置
              </NavLink>
            )}
          </nav>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {me && (
              <Link to="/me" className="hidden items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2 transition hover:border-primary/50 md:flex">
                <AvatarFrame user={me} className="h-7 w-7">
                  <img src={me.photos[0]} alt={me.nickname} className="h-full w-full rounded-full object-cover" />
                </AvatarFrame>
                <NickName user={me} className="max-w-20 truncate text-sm" />
                <LevelSeal user={me} />
              </Link>
            )}
            <button
              ref={moreTriggerRef}
              type="button"
              aria-label="打开更多功能"
              aria-haspopup="dialog"
              aria-expanded={mobileMoreOpen}
              onClick={() => setMobileMoreOpen(true)}
              className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground md:hidden"
            >
              <Menu size={18} aria-hidden="true" />
              更多
            </button>
            <LocalAccountMenu />
          </div>
        </div>
      </header>
      <MobileMoreMenu
        open={mobileMoreOpen}
        onClose={() => setMobileMoreOpen(false)}
        triggerRef={moreTriggerRef}
        items={MORE}
        isAdmin={isAdmin}
        isMember={!!me}
      />

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>

      <footer className={cn('clouds-red mt-10 text-primary-foreground md:mt-16', chatOpenOnMobile && 'hidden lg:block')}>
        <div className="lattice" />
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-4 text-center text-xs md:hidden">
          <span>仅供18岁以上成年人</span>
          <Link to="/trust#privacy" className="inline-flex min-h-11 items-center text-gold-soft underline-offset-2 hover:underline">隐私保护</Link>
          <Link to="/trust#account" className="inline-flex min-h-11 items-center text-gold-soft underline-offset-2 hover:underline">账号与数据</Link>
        </div>
        <div className="mx-auto hidden max-w-6xl gap-8 px-4 py-12 md:grid md:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="seal h-9 w-9 font-xing text-xl">缘</span>
              <span className="font-xing text-2xl">随缘网</span>
            </div>
            <p className="mt-3 text-sm text-primary-foreground/70">
              缘起即meet,日久见人心。我们相信真诚的相遇,值得被认真对待。
            </p>
          </div>
          <div className="text-sm">
            <p className="mb-3 font-xing text-lg text-gold-soft">温馨提示</p>
            <ul className="space-y-2 text-primary-foreground/70">
              <li>· 本平台仅面向 18 周岁以上成年人</li>
              <li>· 核验状态按实际记录展示,未核验信息不作平台背书</li>
              <li>· 请保护个人隐私,谨防财物往来</li>
              <li><Link className="text-gold-soft/90 transition hover:text-gold-soft" to="/trust#privacy">· 查看安全与隐私说明</Link></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="mb-3 font-xing text-lg text-gold-soft">快捷入口</p>
            <ul className="space-y-2">
              <li><Link className="text-primary-foreground/70 hover:text-gold-soft transition" to="/yuanfen">今日随缘</Link></li>
              <li><Link className="text-primary-foreground/70 hover:text-gold-soft transition" to="/explore">兴趣匹配</Link></li>
              <li><Link className="text-primary-foreground/70 hover:text-gold-soft transition" to="/nearby">同城之缘</Link></li>
              <li><Link className="text-primary-foreground/70 hover:text-gold-soft transition" to="/auth?mode=register">加入随缘网</Link></li>
              <li><Link className="text-primary-foreground/70 hover:text-gold-soft transition" to="/trust#safety">安全帮助</Link></li>
              <li><Link className="text-primary-foreground/70 hover:text-gold-soft transition" to="/trust#account">账号与数据</Link></li>
            </ul>
          </div>
        </div>
        <div className="hidden border-t border-primary-foreground/15 py-4 text-center text-xs text-primary-foreground/50 md:block">
          <span className="inline-flex items-center gap-1.5">
            <MessageCircleHeart size={12} />
            随缘网 · 愿天下有情人终成眷属
          </span>
        </div>
      </footer>

      {/* 登录后的移动端仅保留四个核心任务入口 */}
      {me && !chatOpenOnMobile && !editingField && (
        <nav data-mobile-nav aria-label="手机主导航" className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/25 bg-background/95 shadow-[0_-6px_24px_-16px_rgba(50,17,19,.45)] backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-md items-stretch justify-between px-2 pb-[env(safe-area-inset-bottom)]">
            {MOBILE_TABS.filter(t => !t.feat || featureOn(t.feat)).map(t => {
              const Icon = t.icon
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'relative mx-0.5 flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] transition active:scale-[.97]',
                      isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground',
                    )
                  }
                >
                  <span className="relative">
                    <Icon size={21} />
                    {t.to === '/matches' && mutualCount > 0 && (
                      <span className="absolute -right-2 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] text-primary-foreground">
                        {mutualCount}
                      </span>
                    )}
                  </span>
                  {t.label}
                </NavLink>
              )
            })}
          </div>
        </nav>
      )}
      {me && !chatOpenOnMobile && !editingField && <div aria-hidden="true" className="h-[calc(3.5rem+env(safe-area-inset-bottom))] md:hidden" />}
      {/* 缘阶晋升贺窗: 全站挂载, 自己的缘阶升上去时弹一次 */}
      <LevelUpCelebration />
    </div>
  )
}
