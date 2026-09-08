import { Component, useEffect } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { StoreProvider, useStore } from '@/lib/store'
import type { FeatureKey } from '@/lib/store'
import { portrait } from '@/lib/art'
import { getBasename } from '@/lib/pb'
import { reportErr } from '@/lib/utils'
import { Layout } from '@/components/Layout'
import { HomePage } from '@/pages/Home'
import { AuthPage } from '@/pages/Auth'
import { YuanfenPage } from '@/pages/Yuanfen'
import { ExplorePage } from '@/pages/Explore'
import { NearbyPage } from '@/pages/Nearby'
import { VerifyPage } from '@/pages/Verify'
import { MePage } from '@/pages/Me'
import { MatchesPage } from '@/pages/Matches'
import { CommunityPage } from '@/pages/Community'
import { EventsPage } from '@/pages/Events'
import { FavoritesPage } from '@/pages/Favorites'
import { ReportPage } from '@/pages/Report'
import { BadgesPage } from '@/pages/Badges'
import { AdminPage } from '@/pages/Admin'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** 示例图加载失败时, 全局兜底换成离线意象占位图, 避免破图 */
function ImgGuard() {
  useEffect(() => {
    const fallback = portrait('缘', '#8f1d2c', '#d9a05b')
    const onError = (e: Event) => {
      const el = e.target
      if (el instanceof HTMLImageElement && !el.dataset.fb) {
        el.dataset.fb = '1'
        el.src = fallback
      }
    }
    document.addEventListener('error', onError, true)
    return () => {
      document.removeEventListener('error', onError, true)
    }
  }, [])
  return null
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { account, booted } = useStore()
  if (!booted) {
    return <div className="clouds-paper flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">正在载入你的缘分…</div>
  }
  if (!account) return <Navigate to="/auth" replace />
  return <>{children}</>
}

/** 功能被关闭时的提示页 */
function RequireFeature({ k, children }: { k: FeatureKey; children: ReactNode }) {
  const { featureOn } = useStore()
  if (!featureOn(k)) {
    return (
      <div className="clouds-paper mx-auto max-w-md px-4 py-24 text-center">
        <span className="seal mx-auto flex h-14 w-14 font-xing text-2xl">歇</span>
        <h1 className="mt-4 font-xing text-3xl text-foreground">该功能暂不开放</h1>
        <p className="mt-2 text-sm text-muted-foreground">掌柜正在打理这一处,先回首页看看别的缘分吧。</p>
        <Link to="/" className="btn-primary mt-6 inline-flex">回首页</Link>
      </div>
    )
  }
  return <>{children}</>
}

class ErrorBoundary extends Component<{ children: ReactNode }, { msg: string }> {
  state = { msg: '' }
  static getDerivedStateFromError(e: unknown) {
    return { msg: e instanceof Error ? e.message : String(e) }
  }
  componentDidCatch(e: unknown, info: { componentStack?: string | null }) {
    const base = e instanceof Error ? e.message : String(e)
    reportErr('render', `${base} @@ ${(info?.componentStack ?? '').split('\n').slice(0, 8).join(' > ')}`)
  }
  render() {
    if (this.state.msg) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', fontSize: 13, color: '#9e2130', whiteSpace: 'pre-wrap' }}>
          页面渲染出错,已自动上报: {this.state.msg}
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <StoreProvider>
      <ErrorBoundary>
        <BrowserRouter basename={getBasename()}>
          <ScrollToTop />
          <ImgGuard />
          <Toaster position="top-center" richColors toastOptions={{ style: { fontFamily: 'inherit' } }} />
          <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/login" element={<Navigate to="/auth" replace />} />
            <Route path="/register" element={<Navigate to={{ pathname: '/auth', search: '?mode=register' }} replace />} />
            <Route path="/yuanfen" element={<RequireAuth><RequireFeature k="yuanfen"><YuanfenPage /></RequireFeature></RequireAuth>} />
            <Route path="/explore" element={<RequireAuth><RequireFeature k="explore"><ExplorePage /></RequireFeature></RequireAuth>} />
            <Route path="/nearby" element={<RequireAuth><RequireFeature k="explore"><NearbyPage /></RequireFeature></RequireAuth>} />
            <Route path="/events" element={<RequireAuth><RequireFeature k="events"><EventsPage /></RequireFeature></RequireAuth>} />
            <Route path="/community" element={<RequireAuth><RequireFeature k="community"><CommunityPage /></RequireFeature></RequireAuth>} />
            <Route path="/verify" element={<RequireAuth><VerifyPage /></RequireAuth>} />
            <Route path="/matches" element={<RequireAuth><RequireFeature k="matches"><MatchesPage /></RequireFeature></RequireAuth>} />
            <Route path="/favorites" element={<RequireAuth><FavoritesPage /></RequireAuth>} />
            <Route path="/report" element={<RequireAuth><ReportPage /></RequireAuth>} />
            <Route path="/badges" element={<RequireAuth><BadgesPage /></RequireAuth>} />
            <Route path="/me" element={<RequireAuth><MePage /></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </StoreProvider>
  )
}
