import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ImagePlus, Loader2, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import type { RelationshipFeedbackOutcome } from '@/lib/store-types'
import { cn, fmtTime } from '@/lib/utils'
import { readImageFile } from '@/lib/image-utils'
import { riskWord } from '@/lib/store-model'
import { EmojiRow, Lightbox } from '@/components/ui'
import { clearSessionDraft, readSessionDraft, saveSessionDraft } from '@/lib/session-drafts'

const QUICK_PHRASES = [
  '你周末一般怎么过?',
  '你的头像很有气质,在哪拍的?',
  '互相介绍一下自己吧?',
  '最近有场活动,一起吗?',
]

/** 日期分隔签: 今天 / 昨天 / X 月 X 日 */
const dayLabel = (at: number) => {
  const d = new Date(at)
  const today = new Date()
  const yest = new Date(Date.now() - 86400_000)
  if (d.toDateString() === today.toDateString()) return '今天'
  if (d.toDateString() === yest.toDateString()) return '昨天'
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export function ChatPanel({ user }: { user: User }) {
  const { me, chatWith, loadChat, sendChat, icebreakerFor, markRead, recallMsg, pollChats, loadRelationshipFeedback, setRelationshipFeedback } = useStore()
  const draftOwner = me?.id ?? ''
  const [text, setText] = useState(() => readSessionDraft('chat', draftOwner, user.id)?.text ?? '')
  const [pendingImgs, setPendingImgs] = useState<string[]>([])
  const [lb, setLb] = useState('')
  const [sending, setSending] = useState(false)
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [feedbackEligible, setFeedbackEligible] = useState(false)
  const [feedback, setFeedback] = useState<RelationshipFeedbackOutcome | null>(null)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const loadChatRef = useRef(loadChat)
  const markReadRef = useRef(markRead)
  const pollChatsRef = useRef(pollChats)
  const loadFeedbackRef = useRef(loadRelationshipFeedback)
  const setFeedbackRef = useRef(setRelationshipFeedback)
  useEffect(() => { loadChatRef.current = loadChat }, [loadChat])
  useEffect(() => { markReadRef.current = markRead }, [markRead])
  useEffect(() => { pollChatsRef.current = pollChats }, [pollChats])
  useEffect(() => { loadFeedbackRef.current = loadRelationshipFeedback }, [loadRelationshipFeedback])
  useEffect(() => { setFeedbackRef.current = setRelationshipFeedback }, [setRelationshipFeedback])
  const msgs = chatWith(user.id)
  useEffect(() => { saveSessionDraft('chat', draftOwner, user.id, { text }) }, [draftOwner, user.id, text])

  useEffect(() => {
    let alive = true
    void Promise.resolve().then(async () => {
      if (!alive) return
      setLoading(true)
      setLoadError('')
      setFeedbackEligible(false)
      setFeedback(null)
      try {
        await loadChatRef.current(user.id)
        if (!alive) return
        await markReadRef.current(user.id)
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : '聊天记录加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    })
    return () => { alive = false }
  }, [user.id, retryKey])

  // 首次发送/收到真实消息后立即复核反馈资格，不要求退出或刷新会话。
  // 只在消息条数变化及聊天首次加载完成后读取本人状态，不增加登录首包。
  useEffect(() => {
    if (loading || loadError || !msgs.length) return
    let alive = true
    void loadFeedbackRef.current(user.id)
      .then(state => {
        if (!alive || !state.available) return
        setFeedbackEligible(state.eligible)
        setFeedback(state.outcome)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [user.id, msgs.length, loading, loadError])

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs.length])

  // 准实时收信：只刷新当前会话；成功取得新消息后才更新已读状态。
  useEffect(() => {
    const t = setInterval(() => {
      void pollChatsRef.current(user.id)
        .then(() => markReadRef.current(user.id))
        .catch(() => {})
    }, 12_000)
    return () => clearInterval(t)
  }, [user.id])

  if (!me) return null

  const send = async () => {
    const t = text.trim()
    if ((!t && !pendingImgs.length) || sending) return
    const imgs = pendingImgs.length ? [...pendingImgs] : undefined
    setSending(true)
    try {
      await sendChat(user.id, t, imgs)
      clearSessionDraft('chat', draftOwner, user.id)
      setText('')
      setPendingImgs([])
      if (riskWord(t)) {
        toast.warning('温馨提醒:涉及钱财、验证码等内容请谨慎甄别,随缘网绝不会向你索要财物或密码。')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '消息未发送,内容已为你保留')
    } finally {
      setSending(false)
    }
  }

  const saveFeedback = async (outcome: RelationshipFeedbackOutcome | null) => {
    if (feedbackBusy) return
    setFeedbackBusy(true)
    try {
      const state = await setFeedbackRef.current(user.id, outcome)
      if (!state.available) throw new Error('反馈功能暂未就绪')
      setFeedbackEligible(state.eligible)
      setFeedback(state.outcome)
      toast.success(outcome === null ? '已撤回关系反馈' : '反馈已保存，仅你自己可见')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '反馈未保存，请重试')
    } finally {
      setFeedbackBusy(false)
    }
  }

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    if (pendingImgs.length >= 9) {
      toast('一条消息至多 9 张图')
      return
    }
    try {
      const url = await readImageFile(file, 400, 'chat')
      setPendingImgs(prev => (prev.length >= 9 ? prev : [...prev, url]))
    } catch {
      toast.error('图片读取失败,请换一张')
    }
  }

  return (
    <>
      <div data-mobile-chat-panel className="relative flex min-h-0 min-w-0 flex-1 flex-col lg:h-[540px] lg:min-h-[360px] lg:flex-none">
      <div ref={boxRef} aria-label="聊天消息列表" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {loading && msgs.length === 0 ? (
          <div className="pt-16 text-center text-xs text-muted-foreground">
            <Loader2 size={18} className="mx-auto mb-2 animate-spin text-primary" />
            正在加载这段真实会话…
          </div>
        ) : loadError && msgs.length === 0 ? (
          <div className="pt-16 text-center">
            <p className="text-xs text-muted-foreground">{loadError}</p>
            <button className="btn-outline mt-3 !px-3 !py-1.5 text-xs" onClick={() => setRetryKey(v => v + 1)}>
              <RefreshCw size={13} />重新加载
            </button>
            <p className="mt-2 text-[10px] text-muted-foreground">加载成功前不会清除未读状态。</p>
          </div>
        ) : msgs.length === 0 ? (
          <p className="pt-16 text-center text-xs text-muted-foreground">
            佳音已结,从一句「幸会」开始吧。
          </p>
        ) : null}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const showDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString()
          return (
            <div key={m.id} className="space-y-3">
              {showDay && (
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="cjk-latin shrink-0 rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-[10px] text-muted-foreground">
                    {dayLabel(m.at)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className={cn('flex items-end gap-2', m.from === me.id ? 'justify-end' : 'justify-start')}>
                {m.from !== me.id && <img src={user.photos[0]} alt="" className="h-7 w-7 rounded-full object-cover" />}
                <div className={cn('flex min-w-0 max-w-[82%] flex-col sm:max-w-[70%]', m.from === me.id ? 'items-end' : 'items-start')}>
                  {m.recalled ? (
                    <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">撤回了一条消息</p>
                  ) : (
                    <div className={cn('overflow-hidden rounded-lg', m.from === me.id ? 'bg-primary' : 'border border-border bg-card')}>
                      {(() => {
                        const imgs = m.images ?? (m.image ? [m.image] : [])
                        if (!imgs.length) return null
                        return (
                          <div
                            className={cn(
                              'grid gap-0.5 p-0.5',
                              imgs.length === 1 ? 'grid-cols-1' : imgs.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
                            )}
                          >
                            {imgs.map((src, i) => (
                              <button key={i} className="block overflow-hidden rounded transition hover:opacity-90" onClick={() => setLb(src)} aria-label={`放大图片 ${i + 1}`}>
                                <img src={src} alt="" className={cn('w-full object-cover', imgs.length === 1 ? 'max-h-56' : 'aspect-square')} />
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                      {m.text && (
                        <p className={cn('break-words px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]', m.from === me.id ? 'text-primary-foreground' : 'text-foreground')}>
                          {m.text}
                        </p>
                      )}
                    </div>
                  )}
                  <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                    {fmtTime(m.at)}
                    {m.from === me.id && !m.recalled && (
                      <>
                        <span className={cn('ml-1', m.read ? 'text-gold' : 'opacity-60')}>{m.read ? '已读' : '未读'}</span>
                        <button
                          className="ml-1 inline-flex min-h-10 items-center rounded-md px-2 underline-offset-2 transition hover:bg-primary/5 hover:text-primary hover:underline sm:min-h-0 sm:px-0"
                          onClick={() => {
                            if (Date.now() - m.at > 2 * 60_000) {
                              toast('逾时两分钟,此句收不回了')
                              return
                            }
                            void recallMsg(user.id, m.id)
                              .then(() => toast.success('消息已撤回'))
                              .catch(e => toast.error(e instanceof Error ? e.message : '撤回未成功,请重试'))
                          }}
                        >
                          撤回
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {feedbackEligible && msgs.length > 0 && (
        <div className="border-t border-border bg-secondary/25 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-[11px] text-muted-foreground">这段关系现在更像——</span>
            <button
              className={cn('rounded-full border px-3 py-1 text-[11px] transition', feedback === 'continue' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground/75 hover:border-primary/40')}
              disabled={feedbackBusy}
              onClick={() => void saveFeedback('continue')}
            >
              愿意继续认识
            </button>
            <button
              className={cn('rounded-full border px-3 py-1 text-[11px] transition', feedback === 'pause' ? 'border-gold bg-gold/15 text-gold' : 'border-border bg-card text-foreground/75 hover:border-gold/40')}
              disabled={feedbackBusy}
              onClick={() => void saveFeedback('pause')}
            >
              先暂停认识
            </button>
            {feedback && (
              <button className="text-[10px] text-muted-foreground underline-offset-2 hover:underline" disabled={feedbackBusy} onClick={() => void saveFeedback(null)}>撤回</button>
            )}
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">只作为你自己的试点反馈，不通知对方，也不会自动改变互配、聊天或推荐。</p>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 lg:hidden">
        <span className="text-xs text-muted-foreground">给对方写一句真诚的问候</span>
        <button type="button" aria-controls="chat-quick-actions" aria-expanded={quickActionsOpen}
          onClick={() => setQuickActionsOpen(v => !v)}
          className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary">
          快捷回复 <ChevronDown size={16} className={cn('transition-transform', quickActionsOpen && 'rotate-180')} />
        </button>
      </div>
      <div id="chat-quick-actions" className={cn(
        'min-w-0 lg:block',
        quickActionsOpen
          ? 'absolute inset-x-2 bottom-24 z-30 max-h-[min(36dvh,220px)] overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-lift lg:static lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none'
          : 'hidden',
      )}>
      <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain border-t border-border px-3 pt-2 pb-1">
        {QUICK_PHRASES.map(q => (
          <button
            key={q}
            className="min-h-10 shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            onClick={() => setText(prev => prev.trim() ? `${prev.trimEnd()}\n${q}`.slice(0, 2000) : q)}
          >
            {q}
          </button>
        ))}
      </div>
      <div className="px-3 py-1">
        <EmojiRow onPick={e => setText(t => t + e)} />
      </div>
      </div>
      {pendingImgs.length > 0 && (
        <div className="flex flex-wrap items-start gap-2 px-3 pt-2">
          {pendingImgs.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt={`待发送图片 ${i + 1}`} className="h-16 w-16 rounded-md border border-border object-cover" />
              <button
                className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-red-ink text-primary-foreground shadow-card transition hover:opacity-80"
                onClick={() => setPendingImgs(p => p.filter((_, x) => x !== i))}
                aria-label="移除图片"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <span className="cjk-latin mt-12 text-[10px] text-muted-foreground">{pendingImgs.length}/9</span>
        </div>
      )}
      <div className="flex min-w-0 items-end gap-1.5 border-t border-border p-2.5 sm:gap-2 sm:p-3">
        <button
          className="btn-outline min-h-11 shrink-0 !px-2.5 sm:!px-3 transition active:scale-95"
          aria-label="生成破冰开场白"
          title="破冰助手:按共同兴趣生成开场白"
          onClick={() => setText(prev => prev.trim() ? `${prev.trimEnd()}\n${icebreakerFor(user)}`.slice(0, 2000) : icebreakerFor(user))}
        >
          <Sparkles size={17} />
          <span className="hidden sm:inline">破冰</span>
        </button>
        <button
          className="btn-outline min-h-11 shrink-0 !px-3 transition active:scale-95"
          aria-label="选择图片"
          title="发送图片"
          onClick={() => imgRef.current?.click()}
        >
          <ImagePlus size={15} />
        </button>
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            void pickImage(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <textarea
          aria-label="聊天消息草稿"
          className="input-cn min-h-11 min-w-0 flex-1 resize-none !text-base sm:resize-y"
          rows={2}
          placeholder="写一句问候…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            // Touch keyboards use Return to insert newlines; desktop Enter sends.
            const touchKeyboard = window.matchMedia?.('(pointer: coarse)').matches ?? false
            if (!touchKeyboard && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          maxLength={2000}
        />
        <button
          className="btn-primary min-h-11 min-w-11 shrink-0 !px-3 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void send()}
          disabled={sending || (!text.trim() && !pendingImgs.length)}
          aria-label="发送"
        >
          <Send size={16} />
        </button>
      </div>
      <p className="hidden px-3 pb-2 text-[11px] text-muted-foreground sm:block">Enter 发送 · Shift+Enter 换行 · 文字草稿只在此浏览器标签页暂存</p>
      </div>
      <Lightbox src={lb} onClose={() => setLb('')} />
    </>
  )
}
