import { useRef, useState } from 'react'
import { CalendarPlus, ImagePlus, Images, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { INTERESTS, useStore } from '@/lib/store'
import type { EventItem } from '@/lib/store'
import { Modal, Tag } from '@/components/ui'
import { CityPicker } from '@/components/ui/CityPicker'
import { FESTS, FEST_TEMPLATE } from '@/lib/festivals'
import { cn, readImageFile } from '@/lib/utils'

interface Props {
  open: boolean
  /** 传入则为编辑模式 */
  initial?: EventItem | null
  onClose: () => void
}

export function EventForm({ open, initial, onClose }: Props) {
  const { createEvent, updateEvent, settings, me } = useStore()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [title, setTitle] = useState(initial?.title ?? '')
  // 新发起时默认落在我所在的城市, 同城区县一并带上, 可随时改
  const [city, setCity] = useState(initial?.city ?? me?.city ?? '')
  const [region, setRegion] = useState(initial?.region ?? me?.region ?? '')
  const [date, setDate] = useState(initial?.date ?? '')
  const [time, setTime] = useState(initial?.time ?? '')
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 12))
  const [cover, setCover] = useState(initial?.cover ?? '')
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [desc, setDesc] = useState(initial?.desc ?? '')
  const [requirements, setRequirements] = useState(initial?.requirements ?? '')

  // 选定日期若逢传统佳节, 提供一键佳节模板(后台定制优先)
  const fest = FESTS[date] ?? ''
  const festTpl = fest ? (settings.festTemplates[fest] ?? FEST_TEMPLATE[fest]) : undefined

  const pickCover = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      toast.error('图片太大,请选 4MB 以内的图')
      return
    }
    try {
      setCover(await readImageFile(file))
      toast.success('活动封面已就绪')
    } catch {
      toast.error('图片读取失败,换一张试试')
    }
  }

  const moveImage = (from: number, to: number) => {
    setImages(p => {
      if (from === to || from < 0 || to < 0 || from >= p.length || to >= p.length) return p
      const next = [...p]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const pickAlbum = async (files: FileList | null) => {
    if (!files?.length) return
    const room = 4 - images.length
    const list = [...files].slice(0, room)
    if (list.length < files.length) toast.error('活动相册最多 4 张,多余的已忽略')
    for (const f of list) {
      if (f.size > 4 * 1024 * 1024) {
        toast.error('有图片超过 4MB,已跳过')
        continue
      }
      try {
        const url = await readImageFile(f)
        setImages(p => (p.length >= 4 ? p : [...p, url]))
      } catch {
        toast.error('有图片读取失败,已跳过')
      }
    }
  }

  const polish = () => {
    if (!title.trim()) {
      toast.error('先给活动起个名字,再来润色')
      return
    }
    const t = title.trim()
    const tag = tags[0] ?? '美食'
    const h = (t.length + tags.join('').length) % 2
    const openers = [
      `「${t}」—— 一场为${tag}而设的相逢。`,
      `以${tag}为名,我们把「${t}」攒成一次见面。`,
    ]
    const closers = [
      '名额不多,愿你就是那位同好;报名后私下细聊,初见亦如旧识。',
      '带上好心情即可,其余的我们备好;若你也有故事,现场交换。',
    ]
    const base = desc.trim()
    setDesc(base ? `${openers[h]} ${base} ${closers[h]}` : `${openers[h]} 时间地点以页面信息为准。${closers[h]}`)
    toast.success('介绍已润色,可再修改')
  }

  const submit = () => {
    if (!title.trim()) return toast.error('给活动起个名字吧')
    if (!city) return toast.error('选一座城市')
    if (!date || !time) return toast.error('填好日期与时间')
    const cap = Math.max(2, Math.min(99, Number(capacity) || 12))
    const data = {
      title: title.trim(),
      city,
      region: region || undefined,
      cover: cover || `https://picsum.photos/seed/sy-evt-${title.trim()}/600/400`,
      date,
      time,
      capacity: cap,
      desc: desc.trim() || '发起人暂未写下活动介绍,报名后私下细聊。',
      tags: tags.length ? tags : ['美食'],
      requirements: requirements.trim(),
      images,
    }
    if (initial) {
      if (updateEvent(initial.id, data)) {
        toast.success('活动已更新')
        onClose()
      } else {
        toast.error('只有发起人才能修改这场活动')
      }
    } else {
      const id = createEvent(data)
      if (id) {
        toast.success('活动已发布,你已自动成为首位报名者')
        onClose()
      }
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="space-y-4 p-5 md:p-6">
        <h3 className="flex items-center gap-2 font-xing text-2xl text-foreground">
          <CalendarPlus size={18} className="text-gold" />
          {initial ? '编辑活动' : '发起一场活动'}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs tracking-widest text-muted-foreground">活动名称</label>
            <input className="input-cn" placeholder="如 桂香茶席 · 秋日场" value={title} onChange={e => setTitle(e.target.value)} maxLength={60} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs tracking-widest text-muted-foreground">
              活动地区(省 / 市 / 区县)
              {!initial && me?.city && city === me.city && (
                <span className="ml-2 text-[10px] text-gold">已按你所在城市预填,可随时改</span>
              )}
            </label>
            <CityPicker city={city} region={region} onPick={(c, r) => { setCity(c); setRegion(r) }} />
          </div>
          <div>
            <label className="mb-1 block text-xs tracking-widest text-muted-foreground">人数上限</label>
            <input className="input-cn" type="number" min={2} max={99} value={capacity} onChange={e => setCapacity(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs tracking-widest text-muted-foreground">日期</label>
            <input className="input-cn" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs tracking-widest text-muted-foreground">时间</label>
            <input className="input-cn" type="time" value={time} onChange={e => setTime(e.target.value)} />
          </div>
        </div>
        {festTpl && (
          <div className="flex items-center gap-2.5 rounded-md border border-gold/50 bg-gold/10 px-3 py-2">
            <span className="seal flex h-7 w-7 shrink-0 items-center justify-center font-xing text-sm">节</span>
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/80">
              这天是{fest}。备好了一份佳节模板,一键填入名称、标签与介绍。
            </p>
            <button
              type="button"
              className="shrink-0 rounded-full border border-gold/60 bg-gold/15 px-2.5 py-1 text-[11px] text-gold transition hover:bg-gold/25"
              onClick={() => {
                setTitle(festTpl.title)
                setTags(festTpl.tags.slice(0, 3))
                setDesc(festTpl.desc)
                if (festTpl.requirements) setRequirements(festTpl.requirements)
                toast.success(`${fest}模板已填入,可再修改`)
              }}
            >
              用佳节模板
            </button>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs tracking-widest text-muted-foreground">活动封面(可选,不传则自动生成)</label>
          <div className="flex items-center gap-3">
            <div className="h-20 w-32 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
              {cover ? (
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center text-[10px] text-muted-foreground">暂无封面</span>
              )}
            </div>
            <label className="btn-outline cursor-pointer !px-3 !py-2 text-xs">
              <ImagePlus size={14} />
              上传封面图
              <input type="file" accept="image/*" className="hidden" ref={fileRef} onChange={e => { void pickCover(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {cover && (
              <button className="btn-ghost !px-3 !py-2 text-xs text-muted-foreground" onClick={() => setCover('')}>移除</button>
            )}
          </div>
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1 text-xs tracking-widest text-muted-foreground">
            <Images size={12} />
            活动相册(最多 4 张,拖动可调顺序)
          </label>
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div
                key={img}
                onDragOver={e => { e.preventDefault(); setOverIdx(i) }}
                onDragLeave={() => setOverIdx(o => (o === i ? null : o))}
                onDrop={e => { e.preventDefault(); if (dragIdx !== null) moveImage(dragIdx, i); setDragIdx(null); setOverIdx(null) }}
                className={cn(
                  'relative h-20 w-28 overflow-hidden rounded-md border transition',
                  overIdx === i && dragIdx !== null ? 'border-primary ring-2 ring-primary/40' : 'border-border',
                  dragIdx === i && 'opacity-40',
                )}
              >
                <img
                  src={img}
                  alt=""
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                  className="h-full w-full cursor-grab object-cover active:cursor-grabbing"
                />
                <button
                  title="移除这张"
                  className="absolute right-1 top-1 rounded-full bg-card/90 p-0.5 text-muted-foreground transition hover:text-primary"
                  onClick={() => setImages(p => p.filter((_, idx) => idx !== i))}
                >
                  <X size={12} />
                </button>
                <button
                  title="用这张作为活动封面"
                  className={cn(
                    'absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[10px] transition',
                    cover === img ? 'bg-gold/90 text-accent-foreground' : 'bg-card/90 text-muted-foreground hover:text-primary',
                  )}
                  onClick={() => { setCover(img); toast.success(cover === img ? '这张已是封面' : '相册图已设为封面') }}
                >
                  {cover === img ? '封面' : '设封面'}
                </button>
              </div>
            ))}
            {images.length < 4 && (
              <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground transition hover:border-primary/50 hover:text-primary">
                <ImagePlus size={16} />
                <span className="text-[10px]">添加图片</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={e => { void pickAlbum(e.target.files); e.target.value = '' }} />
              </label>
            )}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs tracking-widest text-muted-foreground">主题标签(至多 3 个)</label>
          <div className="flex flex-wrap gap-1.5">
            {INTERESTS.map(t => (
              <Tag
                key={t}
                active={tags.includes(t)}
                onClick={() => setTags(p => (p.includes(t) ? p.filter(x => x !== t) : p.length >= 3 ? p : [...p, t]))}
              >
                {t}
              </Tag>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 flex items-center justify-between text-xs tracking-widest text-muted-foreground">
            活动介绍
            <button type="button" className="inline-flex items-center gap-1 rounded-sm border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold transition hover:bg-gold/20" onClick={polish}>
              <Wand2 size={10} />
              一键润色
            </button>
          </label>
          <textarea className="input-cn min-h-20 resize-y" placeholder="这场活动玩什么、怎么聚,写得动人些" value={desc} onChange={e => setDesc(e.target.value)} maxLength={5000} />
        </div>
        <div>
          <label className="mb-1 block text-xs tracking-widest text-muted-foreground">活动要求(可选)</label>
          <textarea
            className="input-cn min-h-16 resize-y"
            placeholder="如:需着汉服、限 25-35 岁、自带茶具、活动前需简单自我介绍……"
            value={requirements}
            onChange={e => setRequirements(e.target.value)}
            maxLength={1000}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button className="btn-outline !py-2.5" onClick={onClose}>先不了</button>
          <button className={cn('btn-primary !py-2.5')} onClick={submit}>{initial ? '保存修改' : '发布活动'}</button>
        </div>
      </div>
    </Modal>
  )
}
