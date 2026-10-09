import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Feather, Loader2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { Post, User } from '@/lib/store'
import { TOPICS } from '@/lib/store-model'
import { ComposerModal } from '@/components/community/Composer'
import { PostTile } from '@/components/community/PostTile'
import { PostDialog } from '@/components/community/PostDialog'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { DigestBanner } from '@/components/community/DigestBanner'
import { DigestArchive } from '@/components/community/DigestArchive'
import { DigestModal } from '@/components/community/DigestModal'
import { cn } from '@/lib/utils'

const TOPIC_DESC: Record<string, string> = {
  认识我: '用一段真实经历让别人认识你，不是简历，也不是人设包装。',
  兴趣见闻: '分享你真正投入的兴趣与见闻，让同好知道你为什么喜欢。',
  活动回顾: '记录真实参加过的活动与现场感受，帮助别人了解活动，也了解你。',
  想一起做: '发起一次轻量同行：看展、徒步、读书、喝茶……把地点与期待说清楚。',
}


export function CommunityPage() {
  const { posts, digests, viewDigest, me, loadCommunityPosts, loadCommunityDigests } = useStore()
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [detailId, setDetailId] = useState('')
  const [profile, setProfile] = useState<User | null>(null)
  const [readingId, setReadingId] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [sort, setSort] = useState<'new' | 'hot'>('new')
  const [localFirst, setLocalFirst] = useState(true)
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [digestLoading, setDigestLoading] = useState(false)
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const loadPostsRef = useRef(loadCommunityPosts)
  const loadDigestsRef = useRef(loadCommunityDigests)

  useEffect(() => { loadPostsRef.current = loadCommunityPosts }, [loadCommunityPosts])
  useEffect(() => { loadDigestsRef.current = loadCommunityDigests }, [loadCommunityDigests])

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      void loadPostsRef.current({ page: 1, perPage: 18, topic, q: q.trim(), sort, localFirst })
        .then(res => {
          if (!alive) return
          setPage(res.page)
          setTotalItems(res.totalItems)
          setTotalPages(res.totalPages)
          setVisibleIds(res.items.map(item => item.id))
          setError('')
        })
        .catch(e => {
          if (alive) setError(e instanceof Error ? e.message : '社区内容加载失败')
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [q, topic, sort, localFirst, retryKey])

  useEffect(() => {
    void loadDigestsRef.current().catch(() => toast.error('每周精选暂时没有加载成功'))
  }, [])

  const latest = digests[0] ?? null
  const latestCount = latest?.postIds.length ?? 0
  const reading = digests.find(d => d.id === readingId) ?? null
  const digestPosts = useMemo(
    () => (reading ? reading.postIds.map(id => posts.find(p => p.id === id)).filter((p): p is Post => !!p) : []),
    [reading, posts],
  )

  const shown = visibleIds.map(id => posts.find(p => p.id === id)).filter((p): p is Post => !!p)
  const detail = detailId ? posts.find(p => p.id === detailId) ?? null : null

  const startQuery = () => {
    setPage(1)
    setVisibleIds([])
    setLoading(true)
    setError('')
  }

  const retry = () => {
    startQuery()
    setRetryKey(v => v + 1)
  }

  const loadMore = async () => {
    if (loading || page >= totalPages) return
    setLoading(true)
    setError('')
    try {
      const res = await loadPostsRef.current({ page: page + 1, perPage: 18, topic, q: q.trim(), sort, localFirst })
      setPage(res.page)
      setTotalItems(res.totalItems)
      setTotalPages(res.totalPages)
      setVisibleIds(prev => [...prev, ...res.items.map(item => item.id).filter(id => !prev.includes(id))])
    } catch (e) {
      setError(e instanceof Error ? e.message : '下一页加载失败')
    } finally {
      setLoading(false)
    }
  }

  const openDigest = async (d: typeof latest) => {
    if (!d || digestLoading) return
    setDigestLoading(true)
    try {
      if (d.postIds.length) await loadPostsRef.current({ page: 1, perPage: 50, ids: d.postIds })
      void viewDigest(d.id)
      setReadingId(d.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '本期精选暂时无法打开')
    } finally {
      setDigestLoading(false)
    }
  }

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-8 md:py-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-xs tracking-[.4em] text-gold">认识一个人 · 了解一场活动</p>
          <h1 className="mt-1 font-xing text-3xl text-foreground md:text-4xl">见字如面</h1>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input-cn !py-2 !pl-9" placeholder="搜帖文、话题或作者…" value={q} onChange={e => { startQuery(); setQ(e.target.value) }} />
        </div>
        <button className="btn-primary !px-5 !py-2.5 transition active:scale-95" onClick={() => setComposerOpen(true)}>
          <Feather size={15} />
          发帖
        </button>
      </div>

      {latest && latestCount > 0 && (
        <div className="mb-2">
          <DigestBanner digest={latest} count={latestCount} onOpen={() => { void openDigest(latest) }} />
        </div>
      )}
      {digests.length > 0 && (
        <div className="mb-5 flex justify-end">
          <button
            className="inline-flex items-center gap-1 text-xs text-primary transition hover:text-primary/80"
            onClick={() => setArchiveOpen(true)}
          >
            <Archive size={12} />
            翻阅往期合集({digests.length} 期)→
          </button>
        </div>
      )}

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => { startQuery(); setTopic('') }}
          className={cn(
            'shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition',
            topic === '' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40',
          )}
        >
          全部 {topic === '' && totalItems > 0 && <span className="cjk-latin">({totalItems})</span>}
        </button>
        {TOPICS.map(t => (
          <button
            key={t}
              onClick={() => { startQuery(); setTopic(topic === t ? '' : t) }}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition',
              topic === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="-mt-4 mb-4 flex justify-end gap-1.5">
        {me?.city && (
          <button
            onClick={() => { startQuery(); setLocalFirst(v => !v) }}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] transition',
              localFirst ? 'border-gold bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40',
            )}
            title="与我同城的分享排前面"
          >
            同城优先
          </button>
        )}
        {([['new', '最新'], ['hot', '心动最多']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => { startQuery(); setSort(k) }}
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] transition',
              sort === k ? 'border-gold bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {topic && (
        <div className="relative mb-5 overflow-hidden rounded-lg border border-gold/40 bg-gradient-to-r from-red-ink to-primary p-5 text-primary-foreground">
          <span className="pointer-events-none absolute -right-3 -top-6 select-none font-xing text-[6rem] leading-none text-gold-soft/15">{topic.slice(0, 1)}</span>
          <p className="font-xing text-2xl">{topic}</p>
          <p className="mt-1 text-xs leading-relaxed text-primary-foreground/80">{TOPIC_DESC[topic] ?? '同好之人,自然相近。'}</p>
        </div>
      )}

      {error && page === 1 ? (
        <div className="card-cn mx-auto max-w-md rounded-lg p-8 text-center">
          <h3 className="font-xing text-2xl text-foreground">社区内容暂时没有加载成功</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <button className="btn-outline mt-5" onClick={retry}><RefreshCw size={14} />重新加载</button>
        </div>
      ) : loading && page === 1 ? (
        <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center text-sm text-muted-foreground">
          <Loader2 size={20} className="mx-auto mb-3 animate-spin text-primary" />
          正在加载当前条件下的真实分享…
        </div>
      ) : shown.length ? (
        <>
          <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>当前条件共 {totalItems} 篇 · 每次最多加载 18 篇</span>
            {error && <button className="text-primary" onClick={() => { void loadMore() }}>上一轮加载失败，重试</button>}
          </div>
          <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
            {shown.map(p => (
              <PostTile key={p.id} post={p} onOpen={x => setDetailId(x.id)} onProfile={setProfile} />
            ))}
          </div>
          {page < totalPages && (
            <div className="mt-8 text-center">
              <button className="btn-outline min-w-40" disabled={loading} onClick={() => { void loadMore() }}>
                {loading ? <><Loader2 size={14} className="animate-spin" />加载中…</> : '加载更多'}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="rounded-md bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
          {q.trim() ? `没找到与「${q.trim()}」相关的分享,换个词试试。` : '这个话题下还没有分享,来发第一篇吧。'}
        </p>
      )}

      <ComposerModal open={composerOpen} onClose={() => setComposerOpen(false)} />
      <PostDialog post={detail} onClose={() => setDetailId('')} />
      <DetailDialog user={profile} onClose={() => setProfile(null)} />
      <DigestModal digest={reading} posts={digestPosts} onClose={() => setReadingId('')} />
      {archiveOpen && (
        <DigestArchive
          digests={digests}
          onClose={() => setArchiveOpen(false)}
          onPick={d => {
            setArchiveOpen(false)
            void openDigest(d)
          }}
        />
      )}
    </div>
  )
}
