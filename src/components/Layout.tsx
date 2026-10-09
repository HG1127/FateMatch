import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarHeart, ChevronDown, MessageCircleHeart, Sparkles, UserRound } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import type { FeatureKey } from '@/lib/store'
import { cn } from '@/lib/utils'
import { LocalAccountMenu } from '@/components/local/LocalAccountMenu'
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

function MoreDropdown() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const active = MORE.some(m => pathname === m.to)

  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        className={cn(
          'relative flex items-center gap-0.5 rounded-md px-3 py-2 text-sm transition',
          active || open ? 'font-semibold text-primary' : 'text-foreground/70 hover:bg-muted hover:text-foreground',
        )}
        onClick={() => setOpen(o => !o)}
      >
        更多
        <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="card-cn animate-dropdown-in absolute right-0 top-full mt-1 w-52 overflow-visible rounded-lg p-1.5 shadow-lift">
          {MORE.map((m, i) => (
            <NavLink
              key={m.to}
              to={m.to}
              onClick={() => setOpen(false)}
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
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const { me, dataReady, conversations, unread, featureOn, refreshChatSummaries } = useStore()
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
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-gold/25 bg-background/90 backdrop-blur">
        <div className="lattice" />
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="seal h-9 w-9 font-xing text-xl">缘</span>
            <span className="leading-tight">
              <span className="block font-xing text-2xl text-primary">随缘网</span>
              <span className="block text-[10px] tracking-[.3em] text-muted-foreground">一切相遇皆是缘</span>
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
          <div className="flex items-center gap-2">
            {me && (
              <Link to="/me" className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2 transition hover:border-primary/50">
                <AvatarFrame user={me} className="h-7 w-7">
                  <img src={me.photos[0]} alt={me.nickname} className="h-full w-full rounded-full object-cover" />
                </AvatarFrame>
                <NickName user={me} className="max-w-20 truncate text-sm" />
                <LevelSeal user={me} />
              </Link>
            )}
            <LocalAccountMenu />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="clouds-red mt-16 text-primary-foreground">
        <div className="lattice" />
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-3">
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
        <div className="border-t border-primary-foreground/15 py-4 text-center text-xs text-primary-foreground/50">
          <span className="inline-flex items-center gap-1.5">
            <MessageCircleHeart size={12} />
            随缘网 · 愿天下有情人终成眷属
          </span>
        </div>
      </footer>

      {/* 登录后的移动端仅保留四个核心任务入口 */}
      {me && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/25 bg-background/95 backdrop-blur md:hidden">
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
                      'relative mx-0.5 flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] transition',
                      isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground',
                    )
                  }
                >
                  <span className="relative">
                    <Icon size={18} />
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
      {me && <div className="h-14 md:hidden" />}
      {/* 缘阶晋升贺窗: 全站挂载, 自己的缘阶升上去时弹一次 */}
      <LevelUpCelebration />
    </div>
  )
}
