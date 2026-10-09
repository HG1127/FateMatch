import { MapPin, Briefcase, ShieldCheck } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { MatchRing, VerifyBadges, LevelSeal, NickName } from './ui'
import { ageOf } from '@/lib/store-model'

export function ProfileCard({ user, onOpen }: { user: User; onOpen?: (u: User) => void }) {
  const { me, matchScore } = useStore()
  const isSameCity = !!me?.city && user.city === me.city
  return (
    <button
      type="button"
      className="card-cn group w-full cursor-pointer overflow-hidden rounded-lg text-left transition hover:-translate-y-1 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      onClick={() => onOpen?.(user)}
      aria-label={`查看 ${user.nickname} 的资料`}
    >
      <div className="relative aspect-[3/4] overflow-hidden">
        {user.photos[0] ? <img src={user.photos[0]} alt={user.nickname} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center bg-secondary text-sm text-muted-foreground">尚未上传照片</div>}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-red-ink/85 to-transparent" />
        {me && (
          <div className="absolute right-2 top-2 rounded-full bg-card/95 p-1 shadow-card">
            <MatchRing value={matchScore(user)} size={46} />
          </div>
        )}
        {user.verification.photo && user.verification.realname && (
          <span
            className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/95 px-2 py-1 text-[10px] leading-none text-gold shadow-card"
              title="已记录身份与本人照片核验状态"
          >
            <ShieldCheck size={11} />
            核验记录
          </span>
        )}
        <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between">
          <div>
            <p className="font-xing text-2xl text-primary-foreground leading-none">
              <NickName user={user} />
              {ageOf(user.birthDate) > 0 && <span className="cjk-latin ml-1.5 text-base text-gold-soft">{ageOf(user.birthDate)}</span>}
              <LevelSeal user={user} gold className="ml-1.5 align-middle" />
            </p>
            <p className="mt-1 flex items-center gap-2 text-[11px] text-primary-foreground/75">
              <span className="inline-flex items-center gap-0.5"><MapPin size={10} />{regionOf(user)}</span>
              {isSameCity && (
                <span className="rounded-full bg-gold/90 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-red-ink" title="与你同城">
                  同城
                </span>
              )}
              {user.job && <span className="inline-flex items-center gap-0.5"><Briefcase size={10} />{user.job}</span>}
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <VerifyBadges v={user.verification} />
        <div className="flex flex-wrap gap-1">
          {user.interests.slice(0, 4).map(t => (
            <span key={t} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground/80">{t}</span>
          ))}
        </div>
      </div>
    </button>
  )
}
