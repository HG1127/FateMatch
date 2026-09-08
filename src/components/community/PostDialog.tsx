import { useState } from 'react'
import { Bookmark, Heart, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import type { Post, User } from '@/lib/store'
import { fmtTime } from '@/lib/utils'
import { regionOf } from '@/lib/region'
import { Modal, VerifyBadges, EmojiRow, Lightbox } from '@/components/ui'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { cn } from '@/lib/utils'

/** 帖子详情: 全文 + 全部配图 + 回帖区 */
export function PostDialog({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const { users, me, togglePostLike, addComment, removeComment, isFav, toggleFav } = useStore()
  const [comment, setComment] = useState('')
  const [profile, setProfile] = useState<User | null>(null)
  const [lb, setLb] = useState('')

  if (!post || !me) return null
  const author = users.find(u => u.id === post.authorId)
  if (!author) return null
  const liked = post.likes.includes(me.id)
  const faved = isFav('posts', post.id)

  const submitComment = () => {
    if (!comment.trim()) return
    addComment(post.id, comment.trim())
    setComment('')
    toast.success('回帖已发布')
  }

  return (
    <>
      <Modal open onClose={onClose} wide>
        <div className="grid md:grid-cols-2">
          {post.images.length > 0 && (
            <div className={cn('bg-secondary/30 p-4', post.images.length === 1 && 'flex items-center')}>
              <div className={cn('grid gap-2', post.images.length > 1 && 'grid-cols-2')}>
                {post.images.map((img, i) => (
                  <button key={i} className="block w-full transition hover:opacity-90" onClick={() => setLb(img)} aria-label="放大查看">
                    <img src={img} alt="" className="w-full rounded-md border border-border object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col p-5 md:p-6">
            <header className="flex items-center gap-3">
              <button onClick={() => setProfile(author)} className="shrink-0 transition hover:opacity-80">
                <img src={author.photos[0]} alt={author.nickname} className="h-11 w-11 rounded-full border border-gold/40 object-cover" />
              </button>
              <div className="min-w-0 flex-1">
                <button className="block font-xing text-lg text-foreground transition hover:text-primary" onClick={() => setProfile(author)}>
                  {author.nickname}
                </button>
                <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {fmtTime(post.at)} · {regionOf(author)}
                  <VerifyBadges v={author.verification} />
                </p>
              </div>
              <span className="flex items-center gap-1.5">
                {post.featured && (
                  <span className="rounded-sm bg-gold px-1.5 py-0.5 text-[10px] text-accent-foreground" title="社区精选">精选</span>
                )}
                <span className="seal px-1.5 py-0.5 text-[10px]">{post.topic}</span>
              </span>
            </header>

            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{post.text}</p>

            <footer className="mt-4 flex items-center gap-5 border-t border-border pt-3 text-xs text-muted-foreground">
              <button
                className={cn('inline-flex items-center gap-1.5 transition', liked ? 'text-primary' : 'hover:text-primary')}
                onClick={() => togglePostLike(post.id)}
              >
                <Heart size={14} className={liked ? 'fill-current' : ''} />
                心动 <span className="cjk-latin">{post.likes.length}</span>
              </button>
              <span className="inline-flex items-center gap-1.5">
                回帖 <span className="cjk-latin">{post.comments.length}</span>
              </span>
              <button
                className={cn('ml-auto inline-flex items-center gap-1.5 transition', faved ? 'text-gold' : 'hover:text-gold')}
                onClick={() => {
                  toggleFav('posts', post.id)
                  toast(faved ? '已取消收藏' : '已收藏这篇分享')
                }}
              >
                <Bookmark size={14} className={faved ? 'fill-current' : ''} />
                {faved ? '已收藏' : '收藏'}
              </button>
            </footer>

            <div className="mt-3 space-y-2.5">
              {post.comments.map(c => {
                const cu = users.find(u => u.id === c.authorId)
                return (
                  <div key={c.id} className="flex items-start gap-2 rounded-md bg-secondary/50 p-2.5">
                    {cu && <img src={cu.photos[0]} alt="" className="h-7 w-7 rounded-full object-cover" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-muted-foreground">
                        {cu?.nickname ?? '佚名'} · {fmtTime(c.at)}
                      </p>
                      <p className="text-sm text-foreground/85">{c.text}</p>
                    </div>
                    {c.authorId === me.id && (
                      <button
                        className="shrink-0 text-[10px] text-muted-foreground transition hover:text-primary"
                        onClick={() => {
                          removeComment(post.id, c.id)
                          toast('回帖已删除')
                        }}
                      >
                        删除
                      </button>
                    )}
                  </div>
                )
              })}
              {!post.comments.length && <p className="rounded-md bg-secondary/40 p-3 text-center text-xs text-muted-foreground">还没有回帖,第一个回应 TA 吧。</p>}
            </div>

            <div className="mt-3 space-y-1.5">
              <EmojiRow onPick={e => setComment(c => c + e)} />
              <div className="flex gap-2">
              <input
                className="input-cn !py-1.5"
                placeholder="写一句回帖…"
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitComment()}
              />
              <button className="btn-primary shrink-0 !px-3 !py-1.5" onClick={submitComment} aria-label="发送回帖">
                <Send size={14} />
              </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>
      <DetailDialog user={profile} onClose={() => setProfile(null)} />
      <Lightbox src={lb} onClose={() => setLb('')} />
    </>
  )
}
