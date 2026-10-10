import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Ban, Flag, MessageSquarePlus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { ChatPanel } from '@/components/matches/ChatPanel'
import { NewChatPicker } from '@/components/matches/NewChatPicker'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { ReportDialog } from '@/components/safety/ReportDialog'
import { AvatarFrame, NickName } from '@/components/ui'
import { cn, fmtTime } from '@/lib/utils'

export function MatchesPage() {
  const { conversations, isMutual, me, users, unread, toggleBlock, matchScore, match } = useStore()
  const list = conversations()
  const [searchParams, setSearchParams] = useSearchParams()
  // The selected conversation lives in the URL so mobile Back and deep links work.
  const selectedId = searchParams.get('with') ?? ''
  const selectConversation = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('with', id)
    else next.delete('with')
    setSearchParams(next)
    // Switching list/detail on a narrow screen must reveal the chat header immediately.
    if (window.matchMedia('(max-width: 1023px)').matches) window.scrollTo({ top: 0, behavior: 'auto' })
  }
  const [pickerOpen, setPickerOpen] = useState(false)
  const [profile, setProfile] = useState<User | null>(null)
  const [reportFor, setReportFor] = useState<User | null>(null)
  const [query, setQuery] = useState('')
  const [onlyUnread, setOnlyUnread] = useState(false)

  const active = users.find(u => u.id === selectedId && isMutual(u.id))

  if (!me) return null
  const pendingIds = (match.likes[me.id] ?? []).filter(id => !isMutual(id))
  const pending = users.filter(u => pendingIds.includes(u.id))

  const statusOf = (uid: string, lastAt: number, lastFrom: string, liked: boolean) => {
    if (isMutual(uid)) return { label: '互道有意', cls: 'bg-accent/15 text-gold border-accent/40' }
    if (lastAt) return lastFrom === me.id ? { label: '已招呼 · 待回音', cls: 'bg-secondary text-muted-foreground border-border' } : { label: '对方招呼了你', cls: 'bg-primary/10 text-primary border-primary/30' }
    return liked ? { label: '有意 · 待佳音', cls: 'bg-primary/10 text-primary border-primary/30' } : { label: '新对话', cls: 'bg-secondary text-muted-foreground border-border' }
  }

  if (!list.length && !active) {
    return (
      <div className="clouds-paper mx-auto max-w-md px-4 py-20 text-center">
        <span className="seal mx-auto flex h-14 w-14 font-xing text-2xl">音</span>
        <h1 className="mt-4 font-xing text-3xl text-foreground">暂无佳音</h1>
        <p className="mt-2 text-sm text-muted-foreground">双方真实互道「有意」后，会在这里开启佳音。</p>
        {pendingIds.length > 0 && <div className="mt-5 rounded-lg border border-border bg-secondary/30 p-4 text-left"><p className="font-semibold text-foreground">已有 {pendingIds.length} 份有意等待对方自愿回应</p><p className="mt-1 text-xs text-muted-foreground">表达有意不等于对方已读或一定会回复；你可随时撤回自己的选择。</p>{pending.map(u => <button key={u.id} className="mt-2 mr-2 rounded-full border border-border px-3 py-1.5 text-xs text-primary" onClick={() => setProfile(u)}>{u.nickname} · 查看</button>)}</div>}
        <div className="mt-6 flex justify-center">
          <Link to="/yuanfen" className="btn-primary"><Sparkles size={15} />去看今日推荐</Link>
        </div>
        <DetailDialog user={profile} onClose={() => setProfile(null)} />
      </div>
    )
  }

  const activeConv = list.find(c => c.user.id === active?.id)
  const unreadConvs = list.filter(c => unread(c.user.id) > 0)
  const totalUnread = unreadConvs.reduce((s, c) => s + unread(c.user.id), 0)
  const visibleList = list.filter(c => (!onlyUnread || unread(c.user.id) > 0) && (!query.trim() || c.user.nickname.toLowerCase().includes(query.trim().toLowerCase())))

  return (
    <div className={cn('clouds-paper mx-auto max-w-6xl', active ? 'px-0 py-0 lg:px-4 lg:py-14' : 'px-4 py-6 md:py-14')}>
      <div className={cn('mb-6 text-center lg:mb-8', active && 'hidden lg:block')}>
        <p className="text-xs tracking-[.4em] text-gold">我的佳音</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">往来与佳音</h1>
        <p className="mt-2 text-sm text-muted-foreground">这里只展示双方真实互道「有意」的关系 · 点头像看资料,点卡片进入聊天</p>
      </div>

      {pendingIds.length > 0 && <div className={cn('card-cn mx-auto mb-6 max-w-3xl rounded-lg p-4', active && 'hidden lg:block')}><p className="font-semibold text-foreground">待回应的有意 · {pendingIds.length}</p><p className="mt-1 text-xs text-muted-foreground">这里只记录你主动表达过的有意，不暗示对方已经看过或即将回应。</p><div className="mt-2 flex flex-wrap gap-2">{pending.map(u => <button key={u.id} className="rounded-full border border-border px-3 py-1.5 text-xs text-primary" onClick={() => setProfile(u)}>{u.nickname} · 查看或撤回</button>)}</div></div>}
      {unreadConvs.length > 0 && (
        <div className={cn('card-cn mx-auto mb-6 max-w-3xl rounded-lg p-3.5', active && 'hidden lg:block')}>
          <p className="text-xs tracking-widest text-gold">
            未读佳音 · 共 <span className="cjk-latin">{totalUnread}</span> 条待你回音
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unreadConvs.map(c => (
              <button
                key={c.user.id}
                onClick={() => selectConversation(c.user.id)}
                className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-foreground transition hover:border-primary/60"
              >
                <img src={c.user.photos[0]} alt="" className="h-6 w-6 rounded-full object-cover" />
                {c.user.nickname}
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">{unread(c.user.id)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={cn('grid min-w-0 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]', active && 'gap-0 lg:gap-6')}>
        <div className={cn('min-w-0 space-y-3', active && 'hidden lg:block')}>
          <button className="btn-gold w-full" onClick={() => setPickerOpen(true)}>
            <MessageSquarePlus size={16} />
            选择互配对象
          </button>
          <input className="input-cn" type="search" aria-label="搜索互配对象" placeholder="按昵称搜索互配对象…" value={query} onChange={e => setQuery(e.target.value)} />
          <div className="flex flex-wrap gap-2 text-xs">
            <button className={cn('rounded-full border px-3 py-1.5', !onlyUnread ? 'bg-primary text-primary-foreground' : 'border-border')} onClick={() => setOnlyUnread(false)}>全部 {list.length}</button>
            <button className={cn('rounded-full border px-3 py-1.5', onlyUnread ? 'bg-primary text-primary-foreground' : 'border-border')} onClick={() => setOnlyUnread(true)}>未读 {unreadConvs.length}</button>
          </div>
          {!visibleList.length && <p className="rounded-md border border-border p-3 text-center text-xs text-muted-foreground">没有符合条件的会话，换个筛选试试。</p>}
          <div aria-label="会话列表" className="flex flex-col gap-2 pb-2 lg:pb-0">
            {active && !list.some(c => c.user.id === active.id) && (
              <div role="button" tabIndex={0} aria-label={`打开与${active.nickname}的聊天`} className="card-cn flex min-h-[76px] w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg p-3 ring-2 ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => selectConversation(active.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectConversation(active.id) } }}>
                <button className="shrink-0 transition hover:opacity-80" onClick={e => { e.stopPropagation(); setProfile(active) }} aria-label="查看资料">
                  <AvatarFrame user={active} className="h-11 w-11">
                    <img src={active.photos[0]} alt={active.nickname} className="h-full w-full rounded-full object-cover" />
                  </AvatarFrame>
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-xing text-lg"><NickName user={active} className="block truncate text-foreground" /></span>
                  <span className="mt-1 inline-block rounded-sm border border-border bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">新对话</span>
                </span>
              </div>
            )}
            {visibleList.map(c => {
              const st = statusOf(c.user.id, c.lastAt, c.lastFrom, c.liked)
              return (
                <div
                  key={c.user.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`打开与${c.user.nickname}的聊天`}
                  onClick={() => selectConversation(c.user.id)}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectConversation(c.user.id) } }}
                  className={cn(
                    'card-cn flex min-h-[76px] w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    active?.id === c.user.id ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-primary/40',
                  )}
                >
                  <button className="shrink-0 transition hover:opacity-80" onClick={e => { e.stopPropagation(); setProfile(c.user) }} aria-label="查看资料">
                    <AvatarFrame user={c.user} className="h-11 w-11">
                      <img src={c.user.photos[0]} alt={c.user.nickname} className="h-full w-full rounded-full object-cover" />
                    </AvatarFrame>
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-xing text-lg"><NickName user={c.user} className="block truncate text-foreground" /></span>
                      <span className="flex shrink-0 items-center gap-1">
                        {unread(c.user.id) > 0 && (
                          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                            {unread(c.user.id)}
                          </span>
                        )}
                        {c.lastAt > 0 && <span className="text-[10px] text-muted-foreground">{fmtTime(c.lastAt)}</span>}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{c.lastText || '点卡片进入聊天'}</span>
                    <span className={cn('mt-1 inline-block rounded-sm border px-1 py-0.5 text-[10px]', st.cls)}>{st.label}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className={cn('card-cn min-w-0 overflow-hidden rounded-lg', active ? 'flex h-[calc(100dvh-4.0625rem-env(safe-area-inset-top))] min-h-0 flex-col rounded-none border-x-0 border-y-0 sm:h-[calc(100dvh-4.5625rem-env(safe-area-inset-top))] lg:h-auto lg:rounded-lg lg:border' : 'hidden lg:block')}>
          {active ? (
            <>
              <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                <button type="button" onClick={() => selectConversation('')} aria-label="返回会话列表"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-primary active:bg-primary/10 lg:hidden">
                  <ArrowLeft size={21} />
                </button>
                <button className="hidden h-11 w-11 shrink-0 items-center justify-center transition hover:opacity-80 sm:flex" onClick={() => setProfile(active)} aria-label="查看资料">
                  <AvatarFrame user={active} className="h-9 w-9">
                    <img src={active.photos[0]} alt={active.nickname} className="h-full w-full rounded-full object-cover" />
                  </AvatarFrame>
                </button>
                <div className="min-w-0 flex-1">
                  <button type="button" className="max-w-full text-left font-xing text-lg leading-none" onClick={() => setProfile(active)} aria-label={`查看${active.nickname}的资料`}><NickName user={active} className="block truncate text-foreground" /></button>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {regionOf(active)} · {active.job} · 规则参考 <span className="cjk-latin text-gold">{matchScore(active)}</span> 分
                  </p>
                  {me && active.interests.some(t => me.interests.includes(t)) && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {active.interests.filter(t => me.interests.includes(t)).slice(0, 3).map(t => (
                        <span key={t} className="rounded-sm bg-primary/10 px-1 py-0.5 text-[10px] text-primary">同好 {t}</span>
                      ))}
                    </p>
                  )}
                </div>
                {(() => {
                  const st = statusOf(active.id, activeConv?.lastAt ?? 0, activeConv?.lastFrom ?? '', activeConv?.liked ?? false)
                  return <span className={cn('hidden rounded-sm border px-1.5 py-0.5 text-[10px] sm:inline-block', st.cls)}>{st.label}</span>
                })()}
                <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                  <button
                    title="举报" aria-label="举报该会员"
                    className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-primary"
                    onClick={() => setReportFor(active)}
                  >
                    <Flag size={15} />
                  </button>
                  <button
                    title="拉黑" aria-label="拉黑该会员"
                    className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-primary"
                    onClick={() => {
                      void toggleBlock(active.id)
                        .then(blocked => {
                          if (!blocked) return
                          selectConversation('')
                          toast.success('已拉黑,本次聊天已关闭')
                        })
                        .catch(e => toast.error(e instanceof Error ? e.message : '拉黑未保存,请重试'))
                    }}
                  >
                    <Ban size={15} />
                  </button>
                </div>
              </div>
              <ChatPanel key={active.id} user={active} />
            </>
          ) : (
            <div className="flex h-[540px] flex-col items-center justify-center gap-3 text-center">
              <span className="seal flex h-12 w-12 font-xing text-xl">聊</span>
              <p className="text-sm text-muted-foreground">点头像看资料,点卡片进入聊天</p>
              <button className="btn-gold mt-1" onClick={() => setPickerOpen(true)}>
                选择互配对象
              </button>
            </div>
          )}
        </div>
      </div>

      <NewChatPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={u => {
          selectConversation(u.id)
          setPickerOpen(false)
        }}
      />
      <DetailDialog user={profile} onClose={() => setProfile(null)} />
      <ReportDialog user={reportFor} onClose={() => setReportFor(null)} />
    </div>
  )
}
