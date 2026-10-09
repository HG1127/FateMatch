import { useState } from 'react'
import { Bookmark, Heart, Send, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { Post, User } from '@/lib/store'
import { fmtTime } from '@/lib/utils'
import { regionOf } from '@/lib/region'
import { Modal, VerifyBadges, EmojiRow, Lightbox } from '@/components/ui'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { cn } from '@/lib/utils'

/** 帖子详情: 全文 + 全部配图 + 回帖区 */
export function PostDialog({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const { users, me, togglePostLike, addComment, removeComment, isFav, toggleFav, editOwnPost } = useStore()
  const [comment, setComment] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [profile, setProfile] = useState<User | null>(null)
  const [lb, setLb] = useState('')
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(post?.text ?? '')
  const [editingBusy, setEditingBusy] = useState(false)
  const currentPostId = post?.id ?? ''
  const [lastPostId, setLastPostId] = useState(currentPostId)
  if (lastPostId !== currentPostId) {
    setLastPostId(currentPostId)
    setEditing(false)
    setEditText(post?.text ?? '')
  }

  if (!post || !me) return null
  const author = users.find(u => u.id === post.authorId)
  if (!author) return null
  const liked = post.likes.includes(me.id)
  const faved = isFav('posts', post.id)

  const submitComment = async () => {
    if (!comment.trim() || commentBusy) return
    setCommentBusy(true)
    try {
      await addComment(post.id, comment.trim())
      setComment('')
      toast.success('回帖已确认发布')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '回帖未发布成功,内容已保留')
    } finally {
      setCommentBusy(false)
    }
  }

  const saveEdit = async () => {
    if (editingBusy) return
    if (editText.trim().length < 5) return toast.error('分享至少需要 5 个字')
    setEditingBusy(true)
    try {
      if (!await editOwnPost(post.id, editText.trim())) throw new Error('仅能修改自己发布的内容')
      toast.success('分享内容已确认更新')
      setEditing(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '修改未保存，请重试')
    } finally {
      setEditingBusy(false)
    }
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

            {post.authorId === me.id && !editing && <button className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => { setEditText(post.text); setEditing(true) }}><PencilLine size={13} />编辑我的分享</button>}
            {editing ? <div className="mt-3 space-y-2">
              <textarea aria-label="编辑分享内容" className="input-cn min-h-32 w-full" maxLength={5000} value={editText} onChange={e => setEditText(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">仅更新文字，原有图片和话题不变；内容经服务端确认后才生效。</p>
              <div className="flex gap-2"><button className="btn-outline" disabled={editingBusy} onClick={() => { setEditing(false); setEditText(post.text) }}>取消</button><button className="btn-primary" disabled={editingBusy || editText.trim().length < 5} onClick={() => { void saveEdit() }}>{editingBusy ? '保存中…' : '保存修改'}</button></div>
            </div> : <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{post.text}</p>}

            <footer className="mt-4 flex items-center gap-5 border-t border-border pt-3 text-xs text-muted-foreground">
              <button
                className={cn('inline-flex items-center gap-1.5 transition', liked ? 'text-primary' : 'hover:text-primary')}
                onClick={() => { void togglePostLike(post.id).catch(e => toast.error(e instanceof Error ? e.message : '点赞未保存,请重试')) }}
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
                  void toggleFav('posts', post.id)
                    .then(active => toast.success(active ? '已收藏这篇分享' : '已取消收藏'))
                    .catch(e => toast.error(e instanceof Error ? e.message : '收藏状态未保存,请重试'))
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
                          void removeComment(post.id, c.id)
                            .then(ok => ok ? toast.success('回帖已删除') : toast.error('无权删除这条回帖'))
                            .catch(e => toast.error(e instanceof Error ? e.message : '删除未保存,请重试'))
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
                onKeyDown={e => e.key === 'Enter' && void submitComment()}
                maxLength={1000}
              />
              <button className="btn-primary shrink-0 !px-3 !py-1.5 disabled:opacity-50" disabled={commentBusy} onClick={() => void submitComment()} aria-label="发送回帖">
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
