import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { hashStr, readImageFile, riskWord, useStore } from '@/lib/store'
import type { User } from '@/lib/store'
import { fmtTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { EmojiRow, Lightbox } from '@/components/ui'

const REPLIES = [
  '哈哈,好巧,我正想同你打招呼。',
  '看到你也很喜欢这些,改日细聊?',
  '缘分真是奇妙,幸会 ☺',
  '你周末一般喜欢做什么?',
  '你的封面照片真好看,是在哪儿拍的?',
]

const IMAGE_REPLIES = [
  '这张照片真好看,你的眼光真好。',
  '收到啦,忍不住多看了两眼 ☺',
  '拍得真好,改天给我讲讲背后的故事?',
]

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
  const { me, chatWith, sendChat, pushReply, icebreakerFor, markRead, recallMsg, pollChats } = useStore()
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [pendingImgs, setPendingImgs] = useState<string[]>([])
  const [lb, setLb] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const msgs = chatWith(user.id)

  useEffect(() => {
    markRead(user.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, msgs.length])

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs.length, typing])

  // 准实时收信(v1.9): 会话打开期间每 12 秒拉取服务端会话, 合并对方新消息
  useEffect(() => {
    const t = setInterval(() => {
      void pollChats()
    }, 12_000)
    return () => clearInterval(t)
  }, [pollChats])

  if (!me) return null

  const send = () => {
    const t = text.trim()
    if (!t && !pendingImgs.length) return
    const hadImage = pendingImgs.length > 0
    sendChat(user.id, t, hadImage ? pendingImgs : undefined)
    setText('')
    setPendingImgs([])
    if (riskWord(t)) {
      toast.warning('温馨提醒:涉及钱财、验证码等内容请谨慎甄别,随缘网绝不会向你索要财物或密码。')
    }
    const pool = hadImage ? IMAGE_REPLIES : REPLIES
    const reply = pool[hashStr(t + user.id + (hadImage ? 'img' : '')) % pool.length]
    setTyping(true)
    setTimeout(() => {
      pushReply(user.id, reply)
      setTyping(false)
    }, 1200)
  }

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    if (pendingImgs.length >= 9) {
      toast('一条消息至多 9 张图')
      return
    }
    try {
      const url = await readImageFile(file, 400)
      setPendingImgs(prev => (prev.length >= 9 ? prev : [...prev, url]))
    } catch {
      toast.error('图片读取失败,请换一张')
    }
  }

  return (
    <>
      <div className="flex h-[540px] flex-col">
      <div ref={boxRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <p className="pt-16 text-center text-xs text-muted-foreground">
            佳音已结,从一句「幸会」开始吧。
          </p>
        )}
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
                <div className={cn('flex max-w-[70%] flex-col', m.from === me.id ? 'items-end' : 'items-start')}>
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
                        <p className={cn('px-3 py-2 text-sm leading-relaxed', m.from === me.id ? 'text-primary-foreground' : 'text-foreground')}>
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
                          className="ml-1 underline-offset-2 transition hover:text-primary hover:underline"
                          onClick={() => {
                            if (Date.now() - m.at > 2 * 60_000) {
                              toast('逾时两分钟,此句收不回了')
                              return
                            }
                            recallMsg(user.id, m.id)
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
        {typing && (
          <div className="flex items-end gap-2">
            <img src={user.photos[0]} alt="" className="h-7 w-7 rounded-full object-cover" />
            <p className="flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2.5" aria-label="对方正在输入">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
            </p>
          </div>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto border-t border-border px-3 pt-2">
        {QUICK_PHRASES.map(q => (
          <button
            key={q}
            className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            onClick={() => setText(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <div className="px-3 pt-1">
        <EmojiRow onPick={e => setText(t => t + e)} />
      </div>
      {pendingImgs.length > 0 && (
        <div className="flex flex-wrap items-start gap-2 px-3 pt-2">
          {pendingImgs.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt={`待发送图片 ${i + 1}`} className="h-16 w-16 rounded-md border border-border object-cover" />
              <button
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-ink text-primary-foreground shadow-card transition hover:opacity-80"
                onClick={() => setPendingImgs(p => p.filter((_, x) => x !== i))}
                aria-label="移除图片"
              >
                <X size={9} />
              </button>
            </div>
          ))}
          <span className="cjk-latin mt-12 text-[10px] text-muted-foreground">{pendingImgs.length}/9</span>
        </div>
      )}
      <div className="flex gap-2 p-3">
        <button
          className="btn-outline shrink-0 !px-3 transition active:scale-95"
          title="破冰助手:按共同兴趣生成开场白"
          onClick={() => setText(icebreakerFor(user))}
        >
          <Sparkles size={15} />
          破冰
        </button>
        <button
          className="btn-outline shrink-0 !px-3 transition active:scale-95"
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
        <input
          className="input-cn"
          placeholder="写一句问候…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          maxLength={2000}
        />
        <button
          className="btn-primary shrink-0 !px-4 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={send}
          disabled={!text.trim() && !pendingImgs.length}
          aria-label="发送"
        >
          <Send size={16} />
        </button>
      </div>
      </div>
      <Lightbox src={lb} onClose={() => setLb('')} />
    </>
  )
}
