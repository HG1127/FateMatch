import { useRef, useState } from 'react'
import { Feather, ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { readImageFile, riskWord, TOPICS, useStore } from '@/lib/store'
import { Modal, Tag } from '@/components/ui'

/** 发帖收敛为弹窗: 文字 + 多图(至多 6 张) + 话题 */
export function ComposerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, publish, composerDraft, setComposerDraft } = useStore()
  const [text, setText] = useState('')
  const [topic, setTopic] = useState(TOPICS[0])
  const [images, setImages] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // 从活动回顾等入口带来的预填文案: 草稿变化时在渲染期直接同步(React 官方「渲染期调整 state」模式)
  const [seenDraft, setSeenDraft] = useState('')
  if (open && composerDraft && composerDraft !== seenDraft) {
    setSeenDraft(composerDraft)
    setText(composerDraft)
  }

  if (!me) return null

  // 关闭时清掉草稿, 下次带新草稿打开仍能预填
  const close = () => {
    setComposerDraft('')
    setSeenDraft('')
    onClose()
  }

  const pickImages = async (files: FileList | null) => {
    if (!files?.length) return
    const room = 6 - images.length
    const list = [...files].slice(0, room)
    if (list.length < files.length) toast.error('至多 6 张配图,多余的已忽略')
    for (const f of list) {
      if (f.size > 4 * 1024 * 1024) {
        toast.error('有图片超过 4MB,已跳过')
        continue
      }
      try {
        const url = await readImageFile(f, 600)
        setImages(p => (p.length >= 6 ? p : [...p, url]))
      } catch {
        toast.error('有图片读取失败,已跳过')
      }
    }
  }

  const submit = () => {
    if (text.trim().length < 5) {
      toast.error('多写几句吧,至少 5 个字')
      return
    }
    publish(text.trim(), images, topic)
    setText('')
    setImages([])
    toast.success('分享已发布,静候知音')
    if (riskWord(text)) {
      toast.warning('温馨提醒:涉及钱财、投资等内容请遵守真诚交友公约,谨防误导他人。')
    }
    close()
  }

  return (
    <Modal open={open} onClose={close} wide>
      <div className="space-y-4 p-5 md:p-6">
        <h3 className="flex items-center gap-2 font-xing text-2xl text-foreground">
          <Feather size={18} className="text-gold" />
          写一段分享
        </h3>
        <textarea
          className="input-cn min-h-28 resize-y"
          placeholder="分享此刻的生活与心境,让同频的人看见你…"
          value={text}
          onChange={e => setText(e.target.value)}
          autoFocus
        />
        <div>
          <label className="mb-1.5 flex items-center justify-between text-xs tracking-widest text-muted-foreground">
            配图(至多 6 张)
            <span className="cjk-latin">{images.length}/6</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={img} className="relative h-20 w-24 overflow-hidden rounded-md border border-border">
                <img src={img} alt="" className="h-full w-full object-cover" />
                <button
                  title="移除这张"
                  className="absolute right-1 top-1 rounded-full bg-card/90 p-0.5 text-muted-foreground transition hover:text-primary"
                  onClick={() => setImages(p => p.filter((_, idx) => idx !== i))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {images.length < 6 && (
              <button
                className="flex h-20 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                onClick={() => inputRef.current?.click()}
              >
                <ImagePlus size={16} />
                <span className="text-[10px]">添加图片</span>
              </button>
            )}
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { void pickImages(e.target.files); e.target.value = '' }} />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs tracking-widest text-muted-foreground">选择话题</label>
          <div className="flex flex-wrap gap-1.5">
            {TOPICS.map(t => (
              <Tag key={t} active={topic === t} onClick={() => setTopic(t)}>
                {t}
              </Tag>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button className="btn-outline !py-2.5" onClick={close}>先不了</button>
          <button className="btn-primary !py-2.5" onClick={submit}>发布</button>
        </div>
      </div>
    </Modal>
  )
}
