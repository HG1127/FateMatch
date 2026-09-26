import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Ban, Flag, MessageSquarePlus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import type { User } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { ChatPanel } from '@/components/matches/ChatPanel'
import { NewChatPicker } from '@/components/matches/NewChatPicker'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { ReportDialog } from '@/components/safety/ReportDialog'
import { AvatarFrame, NickName } from '@/components/ui'
import { cn, fmtTime } from '@/lib/utils'

export function MatchesPage() {
  const { conversations, isMutual, me, users, unread, toggleBlock, matchScore } = useStore()
  const list = conversations()
  const [searchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState(searchParams.get('with') ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [profile, setProfile] = useState<User | null>(null)
  const [reportFor, setReportFor] = useState<User | null>(null)

  const active = users.find(u => u.id === selectedId && isMutual(u.id))

  if (!me) return null

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
        <div className="mt-6 flex justify-center">
          <Link to="/yuanfen" className="btn-primary"><Sparkles size={15} />去看今日推荐</Link>
        </div>
      </div>
    )
  }

  const activeConv = list.find(c => c.user.id === active?.id)
  const unreadConvs = list.filter(c => unread(c.user.id) > 0)
  const totalUnread = unreadConvs.reduce((s, c) => s + unread(c.user.id), 0)

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">我的佳音</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">往来与佳音</h1>
        <p className="mt-2 text-sm text-muted-foreground">这里只展示双方真实互道「有意」的关系 · 点头像看资料,点卡片进入聊天</p>
      </div>

      {unreadConvs.length > 0 && (
        <div className="card-cn mx-auto mb-6 max-w-3xl rounded-lg p-3.5">
          <p className="text-xs tracking-widest text-gold">
            未读佳音 · 共 <span className="cjk-latin">{totalUnread}</span> 条待你回音
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unreadConvs.map(c => (
              <button
                key={c.user.id}
                onClick={() => setSelectedId(c.user.id)}
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

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          <button className="btn-gold w-full" onClick={() => setPickerOpen(true)}>
            <MessageSquarePlus size={16} />
            选择互配对象
          </button>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {active && !list.some(c => c.user.id === active.id) && (
              <div className="card-cn flex w-64 shrink-0 cursor-pointer items-center gap-3 rounded-lg p-3 ring-2 ring-primary lg:w-full" onClick={() => setSelectedId(active.id)}>
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
            {list.map(c => {
              const st = statusOf(c.user.id, c.lastAt, c.lastFrom, c.liked)
              return (
                <div
                  key={c.user.id}
                  onClick={() => setSelectedId(c.user.id)}
                  className={cn(
                    'card-cn flex w-64 shrink-0 cursor-pointer items-center gap-3 rounded-lg p-3 transition lg:w-full',
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
        <div className="card-cn overflow-hidden rounded-lg">
          {active ? (
            <>
              <div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-4 py-3">
                <button className="shrink-0 transition hover:opacity-80" onClick={() => setProfile(active)} aria-label="查看资料">
                  <AvatarFrame user={active} className="h-9 w-9">
                    <img src={active.photos[0]} alt={active.nickname} className="h-full w-full rounded-full object-cover" />
                  </AvatarFrame>
                </button>
                <div className="flex-1">
                  <p className="font-xing text-lg leading-none"><NickName user={active} className="text-foreground" /></p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {regionOf(active)} · {active.job} · 契合 <span className="cjk-latin text-gold">{matchScore(active)}</span>%
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
                  return <span className={cn('rounded-sm border px-1.5 py-0.5 text-[10px]', st.cls)}>{st.label}</span>
                })()}
                <div className="flex items-center gap-1">
                  <button
                    title="举报"
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-primary"
                    onClick={() => setReportFor(active)}
                  >
                    <Flag size={15} />
                  </button>
                  <button
                    title="拉黑"
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-primary"
                    onClick={() => {
                      toggleBlock(active.id)
                      setSelectedId('')
                      toast('已拉黑,本次聊天已关闭')
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
          setSelectedId(u.id)
          setPickerOpen(false)
        }}
      />
      <DetailDialog user={profile} onClose={() => setProfile(null)} />
      <ReportDialog user={reportFor} onClose={() => setReportFor(null)} />
    </div>
  )
}
