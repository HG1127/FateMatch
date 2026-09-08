import { Heart, MessageCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { Post, User } from '@/lib/store'
import { AvatarFrame, NickName } from '@/components/ui'
import { cn } from '@/lib/utils'

/** 内容优先的社区卡片: 大图 + 饱满正文, 点击进详情 */
export function PostTile({ post, onOpen, onProfile, fresh }: { post: Post; onOpen: (p: Post) => void; onProfile?: (u: User) => void; fresh?: boolean }) {
  const { users, me, togglePostLike } = useStore()
  const author = users.find(u => u.id === post.authorId)
  if (!author || !me) return null
  const liked = post.likes.includes(me.id)
  const isLocal = !!me.city && author.city === me.city

  return (
    <article className="card-cn mb-5 break-inside-avoid overflow-hidden rounded-lg transition hover:-translate-y-0.5 hover:shadow-lift">
      {post.images[0] && (
        <button className="relative block w-full" onClick={() => onOpen(post)} aria-label="查看帖子">
          <img src={post.images[0]} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
          {post.images.length > 1 && (
            <span className="absolute right-2 top-2 rounded-full bg-red-ink/70 px-2 py-0.5 text-[10px] text-primary-foreground shadow-card">
              {post.images.length} 图
            </span>
          )}
          {post.featured && (
            <span className="absolute left-2 top-2 rounded-sm bg-gold px-1.5 py-0.5 text-[10px] text-accent-foreground shadow-card">精选</span>
          )}
        </button>
      )}
      <div className="space-y-2.5 p-4">
        {!post.images[0] && post.featured && (
          <span className="rounded-sm bg-gold px-1.5 py-0.5 text-[10px] text-accent-foreground">精选</span>
        )}
        <button className="block w-full text-left" onClick={() => onOpen(post)}>
          <p className="line-clamp-4 text-[15px] leading-relaxed text-foreground/90">{post.text}</p>
        </button>
        <div className="flex items-center gap-2">
          <button
            className="flex min-w-0 flex-1 items-center gap-2 text-left transition hover:opacity-80"
            onClick={() => onProfile?.(author)}
            aria-label={`查看 ${author.nickname} 的资料`}
          >
            <AvatarFrame user={author} className="h-6 w-6 shrink-0">
              <img src={author.photos[0]} alt={author.nickname} className="h-full w-full rounded-full object-cover" />
            </AvatarFrame>
            <NickName user={author} className="min-w-0 flex-1 truncate text-xs text-muted-foreground" />
          </button>
          {fresh && <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">新帖</span>}
          {isLocal && <span className="shrink-0 rounded-sm bg-gold/90 px-1.5 py-0.5 text-[10px] font-semibold text-red-ink" title="作者与你同城">同城</span>}
          <span className="shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground/70">{post.topic}</span>
          <button
            className={cn('inline-flex shrink-0 items-center gap-1 text-xs transition active:scale-90', liked ? 'text-primary' : 'text-muted-foreground hover:text-primary')}
            onClick={() => togglePostLike(post.id)}
            aria-label="心动"
          >
            <Heart size={13} className={liked ? 'fill-current' : ''} />
            <span className="cjk-latin">{post.likes.length}</span>
          </button>
          <button
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition hover:text-primary"
            onClick={() => onOpen(post)}
            aria-label="回帖"
          >
            <MessageCircle size={13} />
            <span className="cjk-latin">{post.comments.length}</span>
          </button>
        </div>
      </div>
    </article>
  )
}
