import { useMemo, useState } from 'react'
import { Archive, Feather, Search } from 'lucide-react'
import { TOPICS, useStore } from '@/lib/store'
import type { Post, User } from '@/lib/store'
import { ComposerModal } from '@/components/community/Composer'
import { PostTile } from '@/components/community/PostTile'
import { PostDialog } from '@/components/community/PostDialog'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { DigestBanner } from '@/components/community/DigestBanner'
import { DigestArchive } from '@/components/community/DigestArchive'
import { DigestModal } from '@/components/community/DigestModal'
import { cn } from '@/lib/utils'

const TOPIC_DESC: Record<string, string> = {
  慢生活: '把日子过慢一点,茶要细煮,话要细说,人也要细认。',
  山与海: '爱山与海的人,心里都装着一片辽阔,也装得下一个人。',
  诗与远方: '诗是心里的远方,远方是脚下的诗;同路人自会相逢。',
  食记: '人间烟火气,最抚凡人心;一餐一饭里藏着待客的诚意。',
  国风美学: '东方的浪漫,藏在衣袂、墨色与器物的一道褶里。',
  汉服: '罗衣飘飘,裙裾曳地;同袍之谊,从一声「同好」开始。',
}


export function CommunityPage() {
  const { posts, users, digests, viewDigest, me } = useStore()
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [detailId, setDetailId] = useState('')
  const [profile, setProfile] = useState<User | null>(null)
  const [readingId, setReadingId] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [sort, setSort] = useState<'new' | 'hot'>('new')
  const [localFirst, setLocalFirst] = useState(true)

  // 精选帖置顶; 同城动态优先; 其余按所选排序(最新发布 / 心动最多)
  const myCity = me?.city ?? null
  const sorted = useMemo(() => {
    const localOf = (p: Post) => {
      if (!localFirst || !myCity) return 0
      return users.find(u => u.id === p.authorId)?.city === myCity ? 1 : 0
    }
    const arr = [...posts]
    if (sort === 'hot') arr.sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || localOf(b) - localOf(a) || b.likes.length - a.likes.length || b.at - a.at)
    else arr.sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || localOf(b) - localOf(a) || b.at - a.at)
    return arr
  }, [posts, sort, localFirst, myCity, users])
  const latest = digests[0] ?? null
  const latestCount = latest ? latest.postIds.filter(id => posts.some(p => p.id === id)).length : 0
  const reading = digests.find(d => d.id === readingId) ?? null
  const digestPosts = useMemo(
    () => (reading ? reading.postIds.map(id => posts.find(p => p.id === id)).filter((p): p is Post => !!p) : []),
    [reading, posts],
  )

  const kw = q.trim()
  const shown = sorted.filter(p => {
    if (topic && p.topic !== topic) return false
    if (!kw) return true
    const author = users.find(u => u.id === p.authorId)
    return p.text.includes(kw) || p.topic.includes(kw) || (author?.nickname.includes(kw) ?? false)
  })
  const detail = detailId ? sorted.find(p => p.id === detailId) ?? null : null

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-8 md:py-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-xs tracking-[.4em] text-gold">社区分享</p>
          <h1 className="mt-1 font-xing text-3xl text-foreground md:text-4xl">见字如面</h1>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input-cn !py-2 !pl-9" placeholder="搜帖文、话题或作者…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="btn-primary !px-5 !py-2.5 transition active:scale-95" onClick={() => setComposerOpen(true)}>
          <Feather size={15} />
          发帖
        </button>
      </div>

      {latest && latestCount > 0 && (
        <div className="mb-2">
          <DigestBanner digest={latest} count={latestCount} onOpen={() => { viewDigest(latest.id); setReadingId(latest.id) }} />
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
          onClick={() => setTopic('')}
          className={cn(
            'shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition',
            topic === '' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40',
          )}
        >
          全部 <span className="cjk-latin">({posts.length})</span>
        </button>
        {TOPICS.map(t => (
          <button
            key={t}
            onClick={() => setTopic(topic === t ? '' : t)}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition',
              topic === t ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70 hover:border-primary/40',
            )}
          >
            {t} <span className="cjk-latin">({posts.filter(p => p.topic === t).length})</span>
          </button>
        ))}
      </div>

      <div className="-mt-4 mb-4 flex justify-end gap-1.5">
        {me?.city && (
          <button
            onClick={() => setLocalFirst(v => !v)}
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
            onClick={() => setSort(k)}
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

      {shown.length ? (
        <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
          {shown.map(p => (
            <PostTile key={p.id} post={p} onOpen={x => setDetailId(x.id)} onProfile={setProfile} />
          ))}
        </div>
      ) : (
        <p className="rounded-md bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
          {kw ? `没找到与「${kw}」相关的分享,换个词试试。` : '这个话题下还没有分享,来发第一篇吧。'}
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
            viewDigest(d.id)
            setReadingId(d.id)
          }}
        />
      )}
    </div>
  )
}
