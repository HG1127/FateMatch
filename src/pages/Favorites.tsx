import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, FolderPlus, MessageCircleHeart, PencilLine, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { EventItem, User } from '@/lib/store'
import { ageOf } from '@/lib/store-model'
import { regionOf } from '@/lib/region'
import { PostTile } from '@/components/community/PostTile'
import { PostDialog } from '@/components/community/PostDialog'
import { EventCard } from '@/components/events/EventCard'
import { EventDetail } from '@/components/events/EventDetail'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { MatchRing, VerifyBadges } from '@/components/ui'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'users', label: '收藏的佳人' },
  { key: 'posts', label: '收藏的帖文' },
  { key: 'events', label: '收藏的活动' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function FavoritesPage() {
  const { users, posts, events, favs, matchScore, me, favGroups, favGroupOf, addFavGroup, removeFavGroup, renameFavGroup, setFavGroup, isMutual, loadCommunityPosts, loadEventsPage, loadEventDetail } = useStore()
  const [tab, setTab] = useState<TabKey>('users')
  const [profile, setProfile] = useState<User | null>(null)
  const [event, setEvent] = useState<EventItem | null>(null)
  const [postDetailId, setPostDetailId] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [editingGroup, setEditingGroup] = useState('')
  const [renameVal, setRenameVal] = useState('')
  const [groupBusy, setGroupBusy] = useState(false)
  const [loadedPostKey, setLoadedPostKey] = useState('')
  const [loadedEventKey, setLoadedEventKey] = useState('')
  const loadPostsRef = useRef(loadCommunityPosts)
  const loadEventsRef = useRef(loadEventsPage)
  const loadEventDetailRef = useRef(loadEventDetail)
  useEffect(() => { loadPostsRef.current = loadCommunityPosts }, [loadCommunityPosts])
  useEffect(() => { loadEventsRef.current = loadEventsPage }, [loadEventsPage])
  useEffect(() => { loadEventDetailRef.current = loadEventDetail }, [loadEventDetail])
  const favPostKey = favs.posts.join('|')
  const favEventKey = favs.events.join('|')
  useEffect(() => {
    const ids = favPostKey ? favPostKey.split('|').filter(Boolean) : []
    if (!ids.length) return
    const chunks = Array.from({ length: Math.ceil(ids.length / 36) }, (_, i) => ids.slice(i * 36, (i + 1) * 36))
    void Promise.all(chunks.map(chunk => loadPostsRef.current({ page: 1, perPage: chunk.length, ids: chunk })))
      .catch(() => toast.error('部分收藏帖文暂时没有加载成功'))
      .finally(() => setLoadedPostKey(favPostKey))
  }, [favPostKey])
  useEffect(() => {
    const ids = favEventKey ? favEventKey.split('|').filter(Boolean) : []
    if (!ids.length) return
    const chunks = Array.from({ length: Math.ceil(ids.length / 36) }, (_, i) => ids.slice(i * 36, (i + 1) * 36))
    void Promise.all(chunks.map(chunk => loadEventsRef.current({ page: 1, perPage: chunk.length, ids: chunk, localFirst: false })))
      .catch(() => toast.error('部分收藏活动暂时没有加载成功'))
      .finally(() => setLoadedEventKey(favEventKey))
  }, [favEventKey])

  const openEvent = async (item: EventItem) => {
    try {
      setEvent(await loadEventDetailRef.current(item.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '活动详情暂时无法加载')
    }
  }

  if (!me) return null

  const favUsers = favs.users.map(id => users.find(u => u.id === id)).filter((u): u is User => !!u)
  const favPosts = posts.filter(p => favs.posts.includes(p.id))
  const favEvents = favs.events.map(id => events.find(e => e.id === id)).filter((e): e is EventItem => !!e)
  const postHydrating = !!favPostKey && loadedPostKey !== favPostKey
  const eventHydrating = !!favEventKey && loadedEventKey !== favEventKey
  const counts: Record<TabKey, number> = { users: favs.users.length, posts: favs.posts.length, events: favs.events.length }

  const shownUsers = favUsers.filter(u => {
    const g = favGroupOf(u.id)
    if (groupFilter === '') return true
    if (groupFilter === '__none__') return !g
    return g === groupFilter
  })

  const submitNewGroup = async () => {
    if (groupBusy) return
    setGroupBusy(true)
    try {
      const err = await addFavGroup(newGroup)
      if (err) return toast.error(err)
      setGroupFilter(newGroup.trim())
      setNewGroup('')
      toast.success('分组已建好,把心动的人收进来吧')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '分组未保存,请重试')
    } finally {
      setGroupBusy(false)
    }
  }

  const commitRename = async (oldName: string) => {
    if (groupBusy) return
    setGroupBusy(true)
    try {
      const err = await renameFavGroup(oldName, renameVal)
      if (err) return toast.error(err)
      if (groupFilter === oldName) setGroupFilter(renameVal.trim())
      setEditingGroup('')
      toast.success('分组已改名,组内收藏随迁')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '分组改名未保存,请重试')
    } finally {
      setGroupBusy(false)
    }
  }

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">我的收藏</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">藏于心 · 念于怀</h1>
        <p className="mt-2 text-sm text-muted-foreground">心动的人、动人的帖、想去的活动,都替你收好了</p>
      </div>

      <div className="mb-8 flex justify-center gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn('rounded-full border px-4 py-1.5 text-sm transition', tab === t.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40')}
          >
            {t.label} <span className="cjk-latin">({counts[t.key]})</span>
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => setGroupFilter('')}
              className={cn('rounded-full border px-3 py-1 text-xs transition', groupFilter === '' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70')}
            >
              全部
            </button>
            <button
              onClick={() => setGroupFilter('__none__')}
              className={cn('rounded-full border px-3 py-1 text-xs transition', groupFilter === '__none__' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70')}
            >
              未分组
            </button>
            {favGroups.map(g => (
              <span key={g} className="inline-flex items-center overflow-hidden rounded-full border border-border">
                {editingGroup === g ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5">
                    <input
                      className="input-cn !w-24 !py-0.5 !text-xs"
                      value={renameVal}
                      maxLength={6}
                      autoFocus
                      onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void commitRename(g)
                        if (e.key === 'Escape') setEditingGroup('')
                      }}
                    />
                    <button disabled={groupBusy} className="btn-primary !px-2 !py-0.5 text-[10px]" onClick={() => { void commitRename(g) }}>改名</button>
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => setGroupFilter(g)}
                      className={cn('px-3 py-1 text-xs transition', groupFilter === g ? 'bg-primary text-primary-foreground' : 'text-foreground/70 hover:text-primary')}
                    >
                      {g} <span className="cjk-latin">({favUsers.filter(u => favGroupOf(u.id) === g).length})</span>
                    </button>
                    {manageOpen && (
                      <>
                        <button
                          title="重命名"
                          className="bg-muted/60 px-1.5 py-1 text-muted-foreground transition hover:text-primary"
                          onClick={() => {
                            setEditingGroup(g)
                            setRenameVal(g)
                          }}
                        >
                          <PencilLine size={11} />
                        </button>
                        <button
                          title="删除该分组"
                          className="bg-muted/60 px-1.5 py-1 text-muted-foreground transition hover:text-primary"
                          disabled={groupBusy}
                          onClick={() => {
                            if (groupBusy) return
                            setGroupBusy(true)
                            void removeFavGroup(g)
                              .then(() => {
                                if (groupFilter === g) setGroupFilter('')
                                toast.success('分组已删,组内收藏已回到未分组')
                              })
                              .catch(e => toast.error(e instanceof Error ? e.message : '分组删除未保存,请重试'))
                              .finally(() => setGroupBusy(false))
                          }}
                        >
                          <X size={11} />
                        </button>
                      </>
                    )}
                  </>
                )}
              </span>
            ))}
            {manageOpen ? (
              <span className="inline-flex items-center gap-1.5">
                <input
                  className="input-cn !w-28 !py-1 !text-xs"
                  placeholder="分组名,6 字内"
                  value={newGroup}
                  maxLength={6}
                  onChange={e => setNewGroup(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void submitNewGroup() }}
                />
                <button disabled={groupBusy} className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => { void submitNewGroup() }}>建好</button>
                <button className="btn-ghost !px-2 !py-1 text-xs text-muted-foreground" onClick={() => setManageOpen(false)}>完成</button>
              </span>
            ) : (
              <button className="inline-flex items-center gap-1 text-xs text-primary transition hover:text-primary/80" onClick={() => setManageOpen(true)}>
                <FolderPlus size={12} />
                管理分组
              </button>
            )}
          </div>
          {shownUsers.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shownUsers.map(u => (
              <div key={u.id} className="card-cn cursor-pointer rounded-lg p-4 transition hover:-translate-y-1 hover:shadow-lift" onClick={() => setProfile(u)}>
                <div className="flex items-center gap-3">
                  <img src={u.photos[0]} alt={u.nickname} className="h-14 w-14 rounded-full border border-gold/40 object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-xing text-xl text-foreground">
                      {u.nickname} {ageOf(u.birthDate) > 0 && <span className="cjk-latin text-sm text-gold">{ageOf(u.birthDate)}</span>}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{regionOf(u)} · {u.job}</p>
                    <div className="mt-1"><VerifyBadges v={u.verification} /></div>
                  </div>
                  <MatchRing value={matchScore(u)} size={46} />
                </div>
                <p className="mt-3 line-clamp-2 rounded-md bg-secondary/50 p-2 text-xs leading-relaxed text-foreground/75">「{u.bio}」</p>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground" onClick={e => e.stopPropagation()}>
                  分组
                  <select
                    className="rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground"
                    value={favGroupOf(u.id)}
                    disabled={groupBusy}
                    onChange={e => {
                      const group = e.target.value
                      if (groupBusy) return
                      setGroupBusy(true)
                      void setFavGroup(u.id, group)
                        .then(() => toast.success(group ? `已移入「${group}」` : '已移回未分组'))
                        .catch(err => toast.error(err instanceof Error ? err.message : '分组归类未保存,请重试'))
                        .finally(() => setGroupBusy(false))
                    }}
                  >
                    <option value="">未分组</option>
                    {favGroups.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  {isMutual(u.id) ? (
                    <Link
                      to={`/matches?with=${u.id}`}
                      className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-[11px] text-primary transition hover:bg-primary hover:text-primary-foreground"
                      onClick={e => e.stopPropagation()}
                    >
                      <MessageCircleHeart size={12} />
                      去佳音
                    </Link>
                  ) : (
                    <span className="ml-auto text-[10px] text-muted-foreground">互道有意后可聊</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          ) : (
            <Empty
              text={groupFilter ? '这个分组还没有人' : '还没有收藏的佳人'}
              sub={groupFilter ? '换个筛选,或把心动的人移进这个分组。' : '在资料卡上点「收藏」,把心动先存起来。'}
              to="/explore"
              toLabel="去兴趣匹配看看"
            />
          )}
        </>
      )}

      {tab === 'posts' && (
        postHydrating && favs.posts.length && !favPosts.length ? (
          <p className="rounded-md bg-secondary/40 p-8 text-center text-sm text-muted-foreground">正在读取收藏帖文…</p>
        ) : favPosts.length ? (
          <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
            {favPosts.map(p => <PostTile key={p.id} post={p} onOpen={x => setPostDetailId(x.id)} onProfile={setProfile} />)}
          </div>
        ) : (
          <Empty text="还没有收藏的帖文" sub="社区里看到动人的分享,点帖子下方的「收藏」。" to="/community" toLabel="去社区逛逛" />
        )
      )}

      {tab === 'events' && (
        eventHydrating && favs.events.length && !favEvents.length ? (
          <p className="rounded-md bg-secondary/40 p-8 text-center text-sm text-muted-foreground">正在读取收藏活动…</p>
        ) : favEvents.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {favEvents.map(e => <EventCard key={e.id} event={e} onOpen={x => { void openEvent(x) }} />)}
          </div>
        ) : (
          <Empty text="还没有收藏的活动" sub="收藏感兴趣的活动,报名前先留个念想。" to="/events" toLabel="去看看活动" />
        )
      )}

      <DetailDialog user={profile} onClose={() => setProfile(null)} />
      <EventDetail event={event} onClose={() => setEvent(null)} />
      <PostDialog post={postDetailId ? favPosts.find(p => p.id === postDetailId) ?? null : null} onClose={() => setPostDetailId('')} />
    </div>
  )
}

function Empty({ text, sub, to, toLabel }: { text: string; sub: string; to: string; toLabel: string }) {
  return (
    <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center">
      <span className="seal mx-auto flex h-12 w-12 font-xing text-xl">藏</span>
      <h3 className="mt-4 font-xing text-2xl text-foreground">{text}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{sub}</p>
      <Link to={to} className="btn-primary mt-6 inline-flex">
        <Bookmark size={15} />
        {toLabel}
      </Link>
    </div>
  )
}
