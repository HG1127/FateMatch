import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, MapPin, MessageCircleHeart, Ruler, Briefcase, Bookmark, Ban, Flag } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { ageOf } from '@/lib/store-model'
import { MatchRing, Modal, VerifyBadges } from '@/components/ui'
import { ReportDialog } from '@/components/safety/ReportDialog'
import { PostDialog } from '@/components/community/PostDialog'

/* 缘分签: 以两人 id 定一支签文, 同一对人永远同一支 */
const FATE_SLIPS = [
  '此缘似旧识重逢,不必急,故事自然成章。',
  '慢热之缘,愈相处愈有滋味。',
  '你二人同频,一句话便能接住彼此。',
  '此缘需一人先迈步,或许就是你。',
  '恰逢其时的相逢,一句招呼便好。',
  '表平静而里生澜,值得深识一回。',
]
import { cn } from '@/lib/utils'

export function DetailDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { me, matchScore, matchParts, like, unlike, isMutual, isFav, toggleFav, recordVisit, isBlocked, toggleBlock, match, posts } = useStore()
  const nav = useNavigate()
  const [pic, setPic] = useState(0)
  const [reportOpen, setReportOpen] = useState(false)
  const [postId, setPostId] = useState('')
  const [showAllPosts, setShowAllPosts] = useState(false)
  const [liking, setLiking] = useState(false)
  const recordVisitRef = useRef(recordVisit)
  useEffect(() => {
    recordVisitRef.current = recordVisit
  }, [recordVisit])

  const viewedId = user?.id ?? ''
  // 切换查看对象时收起「全部分享」: 渲染期调整 state, 免 effect 级联渲染
  const [seenViewedId, setSeenViewedId] = useState(viewedId)
  if (viewedId !== seenViewedId) {
    setSeenViewedId(viewedId)
    setShowAllPosts(false)
  }
  // 只在查看对象变化时记录一次；ref 始终指向最新 store action，避免函数引用变化制造重复到访。
  useEffect(() => {
    if (viewedId) void recordVisitRef.current(viewedId).catch(() => {})
  }, [viewedId])

  if (!user || !me) return null
  const shared = user.interests.filter(t => me.interests.includes(t))
  const photos = user.photos
  const faved = isFav('users', user.id)
  const blocked = isBlocked(user.id)
  const mutual = isMutual(user.id)
  const iLiked = (match.likes[me.id] ?? []).includes(user.id)
  const slip = FATE_SLIPS[(me.id + user.id).split('').reduce((s, c) => s + c.charCodeAt(0), 0) % FATE_SLIPS.length]

  return (
    <Modal open onClose={onClose} wide>
      <div className="grid md:grid-cols-2">
        <div className="p-4 md:p-5">
          {photos.length > 0 ? <img src={photos[Math.min(pic, photos.length - 1)]} alt={user.nickname} className="aspect-[3/4] w-full rounded-md border border-border object-cover" /> : <div className="flex aspect-[3/4] items-center justify-center rounded-md border border-border bg-secondary text-sm text-muted-foreground">对方尚未上传照片</div>}
          {photos.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {photos.map((p, i) => (
                <button key={i} onClick={() => setPic(i)} className={cn('shrink-0 overflow-hidden rounded border-2 transition', i === pic ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100')}>
                  <img src={p} alt="" className="h-14 w-11 object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4 p-5 md:pr-8">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-xing text-3xl text-foreground">
                {user.nickname}
                {ageOf(user.birthDate) > 0 && <span className="cjk-latin ml-2 text-lg text-gold">{ageOf(user.birthDate)}</span>}
              </h3>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {regionOf(user) && <span className="inline-flex items-center gap-0.5"><MapPin size={11} />{regionOf(user)}</span>}
                {user.job && <span className="inline-flex items-center gap-0.5"><Briefcase size={11} />{user.job}</span>}
                {user.height > 0 && <span className="inline-flex items-center gap-0.5"><Ruler size={11} /><span className="cjk-latin">{user.height}</span>cm</span>}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <MatchRing value={matchScore(user)} size={60} />
              <button
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition',
                  faved ? 'border-gold bg-gold/10 text-gold' : 'border-border text-muted-foreground hover:border-gold/60 hover:text-gold',
                )}
                onClick={() => {
                  void toggleFav('users', user.id)
                    .then(active => toast.success(active ? '已收藏,可在「我的收藏」里找到 TA' : '已从收藏夹移出'))
                    .catch(e => toast.error(e instanceof Error ? e.message : '收藏状态未保存,请重试'))
                }}
              >
                <Bookmark size={12} className={faved ? 'fill-current' : ''} />
                {faved ? '已收藏' : '收藏'}
              </button>
            </div>
          </div>
          <VerifyBadges v={user.verification} />
          <div className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2">
            <p className="text-xs leading-relaxed text-gold">缘分签 · {slip}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">仅为趣味文案，并非关系判断或对方的意愿；不会自动发送。</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(() => {
              const p = matchParts(user)
              return (
                <>
                  <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground/80">共同爱好 +{p.sharedPts}</span>
                  <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground/80">年龄相仿 +{p.agePts}</span>
                  {p.cityPts > 0 && <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground/80">同城 +{p.cityPts}</span>}
                  {p.districtPts > 0 && <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">同区县 +{p.districtPts}</span>}
                  {p.verifyPts > 0 && <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground/80">双方验证 +{p.verifyPts}</span>}
                </>
              )
            })()}
          </div>
          <div>
            <p className="mb-1 text-xs tracking-widest text-muted-foreground">TA 的自述</p>
            <p className="rounded-md border border-border bg-secondary/50 p-3 text-sm leading-relaxed text-foreground/80">「{user.bio}」</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs tracking-widest text-muted-foreground">兴趣爱好{shared.length > 0 && <span className="ml-2 text-primary">与你有 {shared.length} 项共同</span>}</p>
            <div className="flex flex-wrap gap-1.5">
              {user.interests.map(t => (
                <span key={t} className={cn('rounded-sm px-2 py-0.5 text-[11px]', shared.includes(t) ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground/80')}>{t}</span>
              ))}
            </div>
          </div>
          {(() => {
            const all = posts
              .filter(p => p.authorId === user.id)
              .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || b.at - a.at)
            const mine = showAllPosts ? all : all.slice(0, 3)
            if (!all.length) return null
            return (
              <div>
                <p className="mb-1.5 text-xs tracking-widest text-muted-foreground">TA 的分享 · 精选优先</p>
                <div className={cn('space-y-1.5', showAllPosts && 'max-h-72 overflow-y-auto pr-1')}>
                  {mine.map(p => (
                    <button
                      key={p.id}
                      className="flex w-full items-center gap-2.5 rounded-md border border-border bg-secondary/40 p-2 text-left transition hover:border-gold/50"
                      onClick={() => setPostId(p.id)}
                    >
                      {p.images[0] ? (
                        <img src={p.images[0]} alt="" className="h-10 w-14 shrink-0 rounded border border-border object-cover" />
                      ) : (
                        <span className="seal flex h-10 w-14 shrink-0 items-center justify-center rounded font-xing text-sm">帖</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-foreground/90">{p.text}</span>
                        <span className="cjk-latin mt-0.5 block text-[10px] text-muted-foreground">
                          {p.featured ? '精选 · ' : ''}{p.likes.length} 心动 · {p.comments.length} 回帖
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {all.length > 3 && (
                  <button
                    className="mt-1.5 w-full rounded-md border border-border py-1 text-[11px] text-muted-foreground transition hover:border-gold/50 hover:text-gold"
                    onClick={() => setShowAllPosts(v => !v)}
                  >
                    {showAllPosts ? '收起' : `查看全部 ${all.length} 篇`}
                  </button>
                )}
              </div>
            )
          })()}
          <div className="mt-auto space-y-2 pt-2">
            {blocked ? (
              <div className="rounded-md border border-border bg-secondary/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">已拉黑此人,不会再向你推荐,也收不到 TA 的消息。</p>
                <button className="btn-outline mt-3" onClick={() => {
                  void toggleBlock(user.id)
                    .then(active => toast.success(active ? '已重新拉黑' : '已解除拉黑'))
                    .catch(e => toast.error(e instanceof Error ? e.message : '拉黑状态未保存,请重试'))
                }}>
                  <Ban size={14} />
                  解除拉黑
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    className={cn(mutual ? 'btn-gold' : 'btn-primary', '!py-3')}
                    disabled={liking || (iLiked && !mutual)}
                    onClick={async () => {
                      if (mutual) {
                        toast('你们已互道有意,去佳音里聊聊吧')
                        nav(`/matches?with=${user.id}`)
                        return
                      }
                      if (liking) return
                      setLiking(true)
                      try {
                        const back = await like(user.id)
                        if (back) toast.success('双方真实「有意」已确认,佳音已结')
                        else toast.success('「有意」已保存,静候对方真实回应')
                        onClose()
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : '表达「有意」未保存,请重试')
                      } finally {
                        setLiking(false)
                      }
                    }}
                  >
                    <Heart size={16} className={(mutual || iLiked) ? 'fill-current' : ''} />
                    {mutual ? '互道有意 · 去佳音' : iLiked ? '有意 · 待佳音' : '有意'}
                  </button>
                  <button
                    className={mutual ? 'btn-gold !py-3' : 'btn-outline !py-3 opacity-70'}
                    disabled={!mutual}
                    onClick={() => {
                      if (!mutual) return
                      onClose()
                      nav(`/matches?with=${user.id}`)
                    }}
                  >
                    <MessageCircleHeart size={16} />
                    {mutual ? '去佳音聊聊' : '互道有意后可聊天'}
                  </button>
                </div>
                {iLiked && !mutual && (
                  <button
                    className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline disabled:opacity-50"
                    disabled={liking}
                    onClick={async () => {
                      setLiking(true)
                      try {
                        await unlike(user.id)
                        toast.success('已撤回对 TA 的有意')
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : '撤回未成功，请重试')
                      } finally {
                        setLiking(false)
                      }
                    }}
                  >撤回已表达的有意</button>
                )}
                <div className="flex items-center justify-center gap-2 text-[11px]">
                  <button
                    className="inline-flex items-center gap-1 text-muted-foreground transition hover:text-primary"
                    onClick={() => {
                      void toggleBlock(user.id)
                        .then(active => {
                          if (active) {
                            toast.success('已拉黑,世界清静了')
                            onClose()
                          }
                        })
                        .catch(e => toast.error(e instanceof Error ? e.message : '拉黑未保存,请重试'))
                    }}
                  >
                    <Ban size={11} />
                    拉黑
                  </button>
                  <span className="text-border">|</span>
                  <button className="inline-flex items-center gap-1 text-muted-foreground transition hover:text-primary" onClick={() => setReportOpen(true)}>
                    <Flag size={11} />
                    举报
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <ReportDialog user={reportOpen ? user : null} onClose={() => setReportOpen(false)} />
      <PostDialog post={posts.find(p => p.id === postId) ?? null} onClose={() => setPostId('')} />
    </Modal>
  )
}
