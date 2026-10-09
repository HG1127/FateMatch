import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, BellRing, Bookmark, CalendarDays, Heart, KeyRound, MapPin, MessageCircleHeart, PencilLine, Pin, PinOff, ScrollText, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { EventItem } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { Modal, EmojiRow, Lightbox, AvatarFrame } from '@/components/ui'
import { cn, fmtTime } from '@/lib/utils'

export function EventDetail({ event, onClose, onEdit }: { event: EventItem | null; onClose: () => void; onEdit?: (e: EventItem) => void }) {
  const { users, me, joinEvent, leaveEvent, isMutual, reminders, toggleReminder, isFav, toggleFav, deleteEvent, togglePinEvent, contacts, checkins, checkinEvent, getEventCheckinCode, setComposerDraft, addEventComment, toggleEventCommentLike, toggleEventCommentPin, deleteEventComment } = useStore()
  const nav = useNavigate()
  const [confirmDel, setConfirmDel] = useState(false)
  const [pic, setPic] = useState(0)
  const [joinOpen, setJoinOpen] = useState(false)
  const [contact, setContact] = useState('')
  const [comment, setComment] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [lb, setLb] = useState('')
  const [registrationBusy, setRegistrationBusy] = useState(false)
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [checkinCode, setCheckinCode] = useState('')
  const [checkinBusy, setCheckinBusy] = useState(false)
  const [hostCode, setHostCode] = useState('')
  const eventId = event?.id ?? ''
  // 切换活动时重置弹窗内的临时状态: 渲染期调整 state, 免 effect 级联渲染
  const [seenEventId, setSeenEventId] = useState(eventId)
  if (eventId !== seenEventId) {
    setSeenEventId(eventId)
    setConfirmDel(false)
    setPic(0)
    setJoinOpen(false)
    setCheckinOpen(false)
    setCheckinCode('')
    setHostCode('')
    setComment('')
  }
  if (!event || !me) return null
  const joined = event.attendees.includes(me.id)
  const reminded = reminders.includes(event.id)
  const faved = isFav('events', event.id)
  const full = event.attendees.length >= event.capacity
  const isCreator = event.creatorId === me.id
  const canManageCheckin = isCreator || me.role === 'admin'
  const checkedIn = (checkins[me.id] ?? []).includes(event.id)
  const gallery = [event.cover, ...(event.images ?? []).filter(i => i !== event.cover)]
  const attendees = event.attendees.map(id => users.find(u => u.id === id)).filter(Boolean)

  const confirmJoin = async () => {
    if (!contact.trim()) {
      toast.error('先留下联系方式,方便发起人联系你')
      return
    }
    if (registrationBusy) return
    setRegistrationBusy(true)
    try {
      await joinEvent(event.id, contact)
      toast.success('报名已确认 · 提醒与联系方式已保存')
      setJoinOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '报名未完成,请重试')
    } finally {
      setRegistrationBusy(false)
    }
  }

  const submitEventComment = async () => {
    if (!comment.trim() || commentBusy) return
    setCommentBusy(true)
    try {
      await addEventComment(event.id, comment)
      setComment('')
      toast.success('评论已确认发布')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '评论未发布成功,内容已保留')
    } finally {
      setCommentBusy(false)
    }
  }

  return (
    <>
    <Modal open onClose={onClose} wide>
      <div className="relative">
        <img
          src={gallery[Math.min(pic, gallery.length - 1)]}
          alt={event.title}
          className="aspect-[21/9] w-full cursor-zoom-in object-cover"
          onClick={() => setLb(gallery[Math.min(pic, gallery.length - 1)])}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-red-ink/90 to-transparent p-5 pt-14">
          <h3 className="font-xing text-3xl text-primary-foreground">{event.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-primary-foreground/80">
            <span className="inline-flex items-center gap-1"><MapPin size={12} />{event.region || event.city}</span>
            <span className="inline-flex items-center gap-1"><CalendarDays size={12} />{event.date} {event.time}</span>
            <span className="inline-flex items-center gap-1"><Users size={12} />{event.attendees.length}/{event.capacity} 人</span>
          </p>
        </div>
      </div>
      {gallery.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-b border-border bg-secondary/30 px-5 py-2.5">
          {gallery.map((g, i) => (
            <button
              key={i}
              onClick={() => setPic(i)}
              className={cn('shrink-0 overflow-hidden rounded border-2 transition', i === pic ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100')}
            >
              <img src={g} alt="" className="h-14 w-20 object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="space-y-5 p-5 md:p-6">
        <div className="rounded-lg border border-gold/35 bg-gold/5 p-4 text-sm">
          <h4 className="font-semibold text-foreground">参加前请确认</h4>
          <dl className="mt-2 space-y-2 text-xs leading-6">
            <div><dt className="inline font-semibold text-foreground/75">集合区域：</dt><dd className="inline text-foreground">{event.venue || '发起人尚未公开，请报名之前先确认'}</dd></div>
            <div><dt className="inline font-semibold text-foreground/75">活动费用：</dt><dd className="inline text-foreground">{event.costNote || '尚未说明，请勿默认活动免费'}</dd></div>
            <div><dt className="inline font-semibold text-foreground/75">取消/改期：</dt><dd className="inline text-foreground">{event.cancelNote || '发起人尚未说明，请主动确认'}</dd></div>
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">平台不代收活动费用，不保证活动安排；见面请优先选择公共场所。</p>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{event.desc}</p>
        {event.requirements && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-xs tracking-widest text-muted-foreground">
              <ScrollText size={12} />
              活动要求
            </p>
            <p className="rounded-md border border-gold/40 bg-gold/5 p-3 text-xs leading-relaxed text-foreground/80">{event.requirements}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">主办:{event.host} · 主题标签:{event.tags.join(' / ')}</p>
        {isCreator && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 p-2.5 text-xs">
            <span className="text-muted-foreground">你是这场活动的发起人</span>
            <button
              className="btn-outline ml-auto !px-3 !py-1.5 text-xs"
              onClick={() => {
                void togglePinEvent(event.id)
                  .then(ok => ok ? toast.success(event.pinned ? '已取消置顶' : '活动已置顶,会排在列表最前') : toast.error('只有发起人才能操作'))
                  .catch(e => toast.error(e instanceof Error ? e.message : '置顶状态未保存,请重试'))
              }}
            >
              {event.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              {event.pinned ? '取消置顶' : '置顶活动'}
            </button>
            <button className="btn-outline !px-3 !py-1.5 text-xs" onClick={() => onEdit?.(event)}>
              <PencilLine size={13} />
              编辑活动
            </button>
            <button
              className="btn-outline !px-3 !py-1.5 text-xs"
              onClick={() => {
                const lines = event.attendees
                  .filter(id => id !== me.id)
                  .map(id => {
                    const u = users.find(x => x.id === id)
                    const c = contacts[event.id]?.[id]
                    return u ? `${u.nickname}:${c ?? '未留'}` : ''
                  })
                  .filter(Boolean)
                if (!lines.length) {
                  toast('暂无其他报名者的联系方式')
                  return
                }
                navigator.clipboard
                  ?.writeText(lines.join('\n'))
                  .then(() => toast.success('报名者联系方式已复制'))
                  .catch(() => toast.error('复制失败,请逐条查看'))
              }}
            >
              复制联系方式
            </button>
            {confirmDel ? (
              <button
                className="btn-primary !px-3 !py-1.5 text-xs"
                onClick={() => {
                  void deleteEvent(event.id)
                    .then(ok => {
                      if (!ok) return toast.error('只有发起人才能删除这场活动')
                      toast.success('活动已删除')
                      onClose()
                    })
                    .catch(e => toast.error(e instanceof Error ? e.message : '活动删除未完成,请重试'))
                }}
              >
                确认删除
              </button>
            ) : (
              <button className="btn-outline !px-3 !py-1.5 text-xs text-primary" onClick={() => setConfirmDel(true)}>
                <Trash2 size={13} />
                删除
              </button>
            )}
          </div>
        )}
        <div>
          <p className="mb-2 text-xs tracking-widest text-muted-foreground">已报名的有缘人 · 打个招呼,活动现场更从容</p>
          <div className="space-y-2">
            {attendees.map(u => u && (
              <div key={u.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-2.5">
                <AvatarFrame user={u} className="h-9 w-9">
                  <img src={u.photos[0]} alt="" className="h-full w-full rounded-full object-cover" />
                </AvatarFrame>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{u.nickname}</p>
                  <p className="text-[11px] text-muted-foreground">{regionOf(u)} · {u.job}</p>
                </div>
                {isCreator && u.id !== me.id && contacts[event.id]?.[u.id] && (
                  <span className="shrink-0 rounded-sm bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold" title="报名时预留,仅你可见">
                    联系:{contacts[event.id][u.id]}
                  </span>
                )}
                {u.id !== me.id && (
                  <button
                    className="btn-outline !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!isMutual(u.id)}
                    onClick={() => {
                      if (!isMutual(u.id)) return
                      onClose()
                      nav(`/matches?with=${u.id}`)
                    }}
                  >
                    <MessageCircleHeart size={13} />
                    {isMutual(u.id) ? '去佳音' : '互道有意后可聊'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs tracking-widest text-muted-foreground">
            活动评论 · <span className="cjk-latin">{(event.comments ?? []).length}</span>
          </p>
          <div className="space-y-2">
            {[...(event.comments ?? [])].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.at - b.at).map(c => {
              const u = users.find(x => x.id === c.authorId)
              const liked = (c.likes ?? []).includes(me.id)
              return (
                <div key={c.id} className={cn('flex items-start gap-2.5 rounded-md border p-2.5', c.pinned ? 'border-gold/50 bg-gold/5' : 'border-border bg-secondary/40')}>
                  {u && (
                    <AvatarFrame user={u} className="h-8 w-8 shrink-0">
                      <img src={u.photos[0]} alt="" className="h-full w-full rounded-full object-cover" />
                    </AvatarFrame>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {u?.nickname ?? '佚名'} · {fmtTime(c.at)}
                      {c.pinned && <span className="rounded-sm bg-gold px-1 py-0.5 text-[9px] text-accent-foreground">置顶</span>}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-foreground/85">{c.text}</p>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                      <button
                        className={cn('inline-flex items-center gap-1 transition', liked ? 'text-primary' : 'hover:text-primary')}
                        onClick={() => { void toggleEventCommentLike(event.id, c.id).catch(e => toast.error(e instanceof Error ? e.message : '点赞未保存,请重试')) }}
                      >
                        <Heart size={11} className={liked ? 'fill-current' : ''} />
                        {(c.likes ?? []).length || '点赞'}
                      </button>
                      {(isCreator || me.role === 'admin') && (
                        <button
                          className="inline-flex items-center gap-1 transition hover:text-gold"
                          onClick={() => {
                            void toggleEventCommentPin(event.id, c.id)
                              .then(ok => ok ? toast.success(c.pinned ? '已取消置顶' : '评论已置顶,全员可见') : toast.error('无权操作这条评论'))
                              .catch(e => toast.error(e instanceof Error ? e.message : '置顶状态未保存,请重试'))
                          }}
                        >
                          <Pin size={11} />
                          {c.pinned ? '取消置顶' : '置顶'}
                        </button>
                      )}
                      {(c.authorId === me.id || isCreator || me.role === 'admin') && (
                        <button
                          className="inline-flex items-center gap-1 transition hover:text-primary"
                          onClick={() => {
                            void deleteEventComment(event.id, c.id)
                              .then(ok => ok ? toast.success('评论已删除') : toast.error('无权删除这条评论'))
                              .catch(e => toast.error(e instanceof Error ? e.message : '评论删除未保存,请重试'))
                          }}
                        >
                          <Trash2 size={11} />
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {!(event.comments ?? []).length && (
              <p className="rounded-md bg-secondary/40 p-4 text-center text-xs text-muted-foreground">还没有评论,问一句或鼓个掌,都算开场。</p>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            <EmojiRow onPick={e => setComment(c => c + e)} />
            <div className="flex gap-2">
            <input
              className="input-cn"
              placeholder="问问发起人,或给同去的伙伴打个气…"
              value={comment}
              onChange={e => setComment(e.target.value)}
              maxLength={1000}
              onKeyDown={e => {
                if (e.key === 'Enter' && comment.trim()) void submitEventComment()
              }}
            />
            <button
              className="btn-primary shrink-0 !px-4 disabled:opacity-50"
              disabled={commentBusy}
              onClick={() => {
                if (!comment.trim()) return toast.error('写点什么再发吧')
                void submitEventComment()
              }}
            >
              {commentBusy ? '发布中…' : '评论'}
            </button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            className={cn('btn-outline !py-2.5', reminded && 'border-gold/60 text-gold')}
            onClick={() => {
              void toggleReminder(event.id)
                .then(active => toast.success(active ? '提醒已保存,临近时会在活动日历提示你' : '已取消提醒'))
                .catch(e => toast.error(e instanceof Error ? e.message : '提醒状态未保存,请重试'))
            }}
          >
            {reminded ? <BellOff size={15} /> : <BellRing size={15} />}
            {reminded ? '已设提醒' : '设个提醒'}
          </button>
          <button
            className={cn('btn-outline !py-2.5', faved && 'border-gold/60 text-gold')}
            onClick={() => {
              void toggleFav('events', event.id)
                .then(active => toast.success(active ? '已收藏这场活动' : '已从收藏夹移出'))
                .catch(e => toast.error(e instanceof Error ? e.message : '收藏状态未保存,请重试'))
            }}
          >
            <Bookmark size={15} className={faved ? 'fill-current' : ''} />
            {faved ? '已收藏' : '收藏活动'}
          </button>
        </div>
        {canManageCheckin && (
          <button
            className="btn-outline w-full !py-2.5"
            onClick={async () => {
              try {
                const code = await getEventCheckinCode(event.id)
                setHostCode(code)
              } catch (e) {
                toast.error(e instanceof Error ? e.message : '当前无法获取签到码')
              }
            }}
          >
            <KeyRound size={15} />
            {hostCode ? `现场签到码：${hostCode}` : '查看现场签到码'}
          </button>
        )}
        {joined && (
          <button
            className={cn('btn-outline w-full !py-2.5', checkedIn && 'border-gold/60 text-gold')}
            disabled={checkedIn}
            onClick={() => setCheckinOpen(true)}
          >
            {checkedIn ? '已核销到场' : '现场签到'}
          </button>
        )}
        {joined && event.date < new Date().toISOString().slice(0, 10) && (
          <button
            className="btn-gold w-full !py-2.5"
            onClick={() => {
              setComposerDraft(`刚从「${event.title}」回来,想说——`, '活动回顾')
              onClose()
              nav('/community')
            }}
          >
            写篇活动回顾
          </button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-outline !py-3" onClick={onClose}>再看看</button>
          {joined ? (
            <button
              className="btn-ghost border border-border !py-3 disabled:opacity-50"
              disabled={registrationBusy}
              onClick={async () => {
                if (registrationBusy) return
                setRegistrationBusy(true)
                try {
                  await leaveEvent(event.id)
                  toast.success('报名已取消 · 提醒、联系方式与旧签到已同步撤销')
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : '取消报名未完成,请重试')
                } finally {
                  setRegistrationBusy(false)
                }
              }}
            >
              {registrationBusy ? '处理中…' : '取消报名'}
            </button>
          ) : event.date < new Date().toISOString().slice(0, 10) ? (
            <button className="btn-primary !py-3" disabled>
              已结束
            </button>
          ) : (
            <button
              className="btn-primary !py-3"
              disabled={full}
              onClick={() => {
                setContact(me.phone)
                setJoinOpen(true)
              }}
            >
              {full ? '已满员' : '报名牵线'}
            </button>
          )}
        </div>
      </div>
    </Modal>
    {joinOpen && (
      <Modal open onClose={() => setJoinOpen(false)}>
        <div className="space-y-4 p-5 md:p-6">
          <h3 className="font-xing text-2xl text-foreground">留个联系方式</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            便于发起人在活动前与你联系(改期、提醒、集合地点等)。仅发起人可见,其他报名者看不到。
          </p>
          <input
            className="input-cn"
            placeholder="微信号 / 手机号"
            value={contact}
            onChange={e => setContact(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void confirmJoin()}
            maxLength={200}
          />
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-outline !py-2.5" onClick={() => setJoinOpen(false)}>再想想</button>
            <button className="btn-primary !py-2.5 disabled:opacity-50" disabled={registrationBusy} onClick={() => void confirmJoin()}>
              {registrationBusy ? '提交中…' : '确认报名'}
            </button>
          </div>
        </div>
      </Modal>
    )}
    {checkinOpen && (
      <Modal open onClose={() => !checkinBusy && setCheckinOpen(false)}>
        <div className="space-y-4 p-5 md:p-6">
          <h3 className="font-xing text-2xl text-foreground">现场签到</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            到达活动现场后，向主办方获取 6 位签到码。服务端会同时核对你的报名关系和活动签到时间窗。
          </p>
          <input
            className="input-cn cjk-latin text-center text-xl tracking-[.35em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            value={checkinCode}
            onChange={e => setCheckinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
          />
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-outline !py-2.5" disabled={checkinBusy} onClick={() => setCheckinOpen(false)}>取消</button>
            <button
              className="btn-primary !py-2.5 disabled:opacity-50"
              disabled={checkinBusy || checkinCode.length !== 6}
              onClick={async () => {
                if (checkinBusy || checkinCode.length !== 6) return
                setCheckinBusy(true)
                try {
                  await checkinEvent(event.id, checkinCode)
                  toast.success('现场签到已核销')
                  setCheckinOpen(false)
                  setCheckinCode('')
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : '签到未完成，请向主办方确认')
                } finally {
                  setCheckinBusy(false)
                }
              }}
            >
              {checkinBusy ? '核销中…' : '确认签到'}
            </button>
          </div>
        </div>
      </Modal>
    )}
    <Lightbox src={lb} onClose={() => setLb('')} />
    </>
  )
}
