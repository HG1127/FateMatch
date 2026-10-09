import { Heart, MapPin, X } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { MatchRing, VerifyBadges } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ageOf } from '@/lib/store-model'

export function YuanfenCard({ user, onLike, onPass, onUnlike, onUnpass }: { user: User; onLike: () => void; onPass: () => void; onUnlike?: () => void; onUnpass?: () => void }) {
  const { me, matchScore, match } = useStore()
  const shared = me ? user.interests.filter(t => me.interests.includes(t)) : []
  const liked = !!me && (match.likes[me.id] ?? []).includes(user.id)
  const passed = !!me && (match.passes[me.id] ?? []).includes(user.id)
  const [pic, setPic] = useState(0)
  const photo = user.photos[Math.min(pic, user.photos.length - 1)]

  return (
    <div key={user.id} className="card-cn mx-auto grid max-w-3xl overflow-hidden rounded-lg animate-flip-in md:grid-cols-2">
      <div className="relative">
        <img src={photo} alt={user.nickname} className={cn('h-72 w-full object-cover md:h-full', passed && 'opacity-80 saturate-[.7]')} />
        <span className="seal absolute left-3 top-3 px-2 py-1 font-xing text-sm">今日缘</span>
        {liked && <span className="seal absolute right-3 top-3 px-2 py-1 font-xing text-sm">已有意</span>}
        {passed && <span className="absolute right-3 top-3 rounded-sm bg-muted/90 px-2 py-1 text-[10px] text-muted-foreground shadow-card">已且过</span>}
        {user.photos.length > 1 && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
            {user.photos.map((_, i) => (
              <button
                key={i}
                aria-label={`第 ${i + 1} 张照片`}
                onClick={() => setPic(i)}
                className={cn('h-2 rounded-full border border-card/60 transition-all', i === pic ? 'w-5 bg-gold' : 'w-2 bg-card/70 hover:bg-card')}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4 p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-xing text-3xl text-foreground">
              {user.nickname}
              {ageOf(user.birthDate) > 0 && <span className="cjk-latin ml-2 text-lg text-gold">{ageOf(user.birthDate)}</span>}
            </h3>
            <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-0.5"><MapPin size={11} />{regionOf(user)}</span>
              {user.job && <> · {user.job}</>}{user.height > 0 && <> · <span className="cjk-latin">{user.height}</span>cm</>}
            </p>
          </div>
          <MatchRing value={matchScore(user)} size={62} />
        </div>
        <VerifyBadges v={user.verification} />
        <div className="rounded-md border border-border bg-card/70 p-3">
          <p className="mb-2 text-xs font-semibold tracking-wider text-foreground/70">为什么推荐</p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">满足双方寻找对象条件</span>
            {me?.city === user.city && <span className="rounded-full bg-secondary px-2 py-1 text-secondary-foreground">与你同城</span>}
            {shared.slice(0, 2).map(t => <span key={t} className="rounded-full bg-secondary px-2 py-1 text-secondary-foreground">共同兴趣 · {t}</span>)}
            {user.verification.phone && user.verification.realname && user.verification.photo && (
              <span className="rounded-full bg-secondary px-2 py-1 text-secondary-foreground">有核验记录</span>
            )}
          </div>
        </div>
        <p className="rounded-md border border-border bg-secondary/50 p-3 text-sm leading-relaxed text-foreground/80">「{user.bio}」</p>
        <div>
          <p className="mb-1.5 text-xs tracking-widest text-muted-foreground">
            {shared.length > 0 ? `共同爱好 ${shared.length} 项` : 'TA 的爱好'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {user.interests.map(t => (
              <span
                key={t}
                className={
                  shared.includes(t)
                    ? 'rounded-sm bg-primary px-2 py-0.5 text-[11px] text-primary-foreground'
                    : 'rounded-sm bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground/80'
                }
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-3 pt-2">
          {passed ? (
            <button className="btn-outline !py-3 transition hover:border-gold/60 hover:text-gold active:scale-[.97]" onClick={() => onUnpass?.()}>
              <X size={16} />
              重新结缘
            </button>
          ) : (
            <button className="btn-outline !py-3 transition hover:border-primary/60 hover:text-primary active:scale-[.97]" onClick={onPass}>
              <X size={16} />
              且过
            </button>
          )}
          {liked ? (
            <button className="btn-outline !py-3 transition hover:border-gold/60 hover:text-gold active:scale-[.97]" onClick={() => onUnlike?.()}>
              <Heart size={16} className="fill-current text-primary" />
              撤回有意
            </button>
          ) : (
            <button className="btn-primary !py-3 transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[.97]" onClick={onLike}>
              <Heart size={16} />
              有意
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
