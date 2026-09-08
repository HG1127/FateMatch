import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, BellRing, Bookmark, CalendarDays, Heart, MapPin, MessageCircleHeart, PencilLine, Pin, PinOff, ScrollText, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store'
import type { EventItem } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { Modal, EmojiRow, Lightbox, AvatarFrame } from '@/components/ui'
import { cn, fmtTime } from '@/lib/utils'

export function EventDetail({ event, onClose, onEdit }: { event: EventItem | null; onClose: () => void; onEdit?: (e: EventItem) => void }) {
  const { users, me, joinEvent, leaveEvent, sendChat, reminders, toggleReminder, isFav, toggleFav, deleteEvent, togglePinEvent, contacts, checkins, checkinEvent, setComposerDraft, addEventComment, toggleEventCommentLike, toggleEventCommentPin, deleteEventComment } = useStore()
  const nav = useNavigate()
  const [confirmDel, setConfirmDel] = useState(false)
  const [pic, setPic] = useState(0)
  const [joinOpen, setJoinOpen] = useState(false)
  const [contact, setContact] = useState('')
  const [comment, setComment] = useState('')
  const [lb, setLb] = useState('')
  const eventId = event?.id ?? ''
  // 切换活动时重置弹窗内的临时状态: 渲染期调整 state, 免 effect 级联渲染
  const [seenEventId, setSeenEventId] = useState(eventId)
  if (eventId !== seenEventId) {
    setSeenEventId(eventId)
    setConfirmDel(false)
    setPic(0)
    setJoinOpen(false)
    setComment('')
  }
  if (!event || !me) return null
  const joined = event.attendees.includes(me.id)
  const reminded = reminders.includes(event.id)
  const faved = isFav('events', event.id)
  const full = event.attendees.length >= event.capacity
  const isCreator = event.creatorId === me.id
  const checkedIn = (checkins[me.id] ?? []).includes(event.id)
  const gallery = [event.cover, ...(event.images ?? []).filter(i => i !== event.cover)]
  const attendees = event.attendees.map(id => users.find(u => u.id === id)).filter(Boolean)

  const confirmJoin = () => {
    if (!contact.trim()) {
      toast.error('先留下联系方式,方便发起人联系你')
      return
    }
    joinEvent(event.id, contact)
    toast.success('报名成功 · 已自动设提醒,临近时不会错过')
    setJoinOpen(false)
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
        <p className="text-sm leading-relaxed text-foreground/85">{event.desc}</p>
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
                if (togglePinEvent(event.id)) toast(event.pinned ? '已取消置顶' : '活动已置顶,会排在列表最前')
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
                  if (deleteEvent(event.id)) {
                    toast('活动已删除')
                    onClose()
                  } else {
                    toast.error('只有发起人才能删除这场活动')
                  }
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
                    className="btn-outline !px-3 !py-1.5 text-xs"
                    onClick={() => {
                      sendChat(u.id, `你好,我也报名了「${event.title}」,到时候见 ☺`)
                      toast.success('招呼已送达,活动现场见')
                    }}
                  >
                    <MessageCircleHeart size={13} />
                    打招呼
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
                        onClick={() => toggleEventCommentLike(event.id, c.id)}
                      >
                        <Heart size={11} className={liked ? 'fill-current' : ''} />
                        {(c.likes ?? []).length || '点赞'}
                      </button>
                      {(isCreator || me.role === 'admin') && (
                        <button
                          className="inline-flex items-center gap-1 transition hover:text-gold"
                          onClick={() => {
                            if (toggleEventCommentPin(event.id, c.id)) toast(c.pinned ? '已取消置顶' : '评论已置顶,全员可见')
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
                            if (deleteEventComment(event.id, c.id)) toast('评论已删除')
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
              onKeyDown={e => {
                if (e.key === 'Enter' && comment.trim()) {
                  addEventComment(event.id, comment)
                  setComment('')
                  toast.success('评论已发布')
                }
              }}
            />
            <button
              className="btn-primary shrink-0 !px-4"
              onClick={() => {
                if (!comment.trim()) return toast.error('写点什么再发吧')
                addEventComment(event.id, comment)
                setComment('')
                toast.success('评论已发布')
              }}
            >
              评论
            </button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            className={cn('btn-outline !py-2.5', reminded && 'border-gold/60 text-gold')}
            onClick={() => {
              toggleReminder(event.id)
              toast(reminded ? '已取消提醒' : '已设提醒,临近时会在活动日历提示你')
            }}
          >
            {reminded ? <BellOff size={15} /> : <BellRing size={15} />}
            {reminded ? '已设提醒' : '设个提醒'}
          </button>
          <button
            className={cn('btn-outline !py-2.5', faved && 'border-gold/60 text-gold')}
            onClick={() => {
              toggleFav('events', event.id)
              toast(faved ? '已从收藏夹移出' : '已收藏这场活动')
            }}
          >
            <Bookmark size={15} className={faved ? 'fill-current' : ''} />
            {faved ? '已收藏' : '收藏活动'}
          </button>
        </div>
        {joined && (
          <button
            className={cn('btn-outline w-full !py-2.5', checkedIn && 'border-gold/60 text-gold')}
            disabled={checkedIn}
            onClick={() => {
              if (checkinEvent(event.id)) toast.success('已打卡 · 活动现场见')
            }}
          >
            {checkedIn ? '已打卡 · 活动现场见' : '到场打卡'}
          </button>
        )}
        {joined && event.date < new Date().toISOString().slice(0, 10) && (
          <button
            className="btn-gold w-full !py-2.5"
            onClick={() => {
              setComposerDraft(`刚从「${event.title}」回来,想说——`)
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
            <button className="btn-ghost border border-border !py-3" onClick={() => { leaveEvent(event.id); toast('已取消报名') }}>
              取消报名
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
            onKeyDown={e => e.key === 'Enter' && confirmJoin()}
          />
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-outline !py-2.5" onClick={() => setJoinOpen(false)}>再想想</button>
            <button className="btn-primary !py-2.5" onClick={confirmJoin}>
              确认报名
            </button>
          </div>
        </div>
      </Modal>
    )}
    <Lightbox src={lb} onClose={() => setLb('')} />
    </>
  )
}
