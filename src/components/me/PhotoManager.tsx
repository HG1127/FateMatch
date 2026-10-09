import { useRef, useState } from 'react'
import { Camera, GripVertical, Star, X, ArrowLeft, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import { cn } from '@/lib/utils'
import { readImageFile } from '@/lib/image-utils'

export function PhotoManager() {
  const { me, addPhotos, removePhoto, setAvatar, reorderPhotos } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  if (!me) return null
  const full = me.photos.length >= 6

  const finishDrag = () => {
    setDragIdx(null)
    setOverIdx(null)
  }
  const movePhoto = (from: number, to: number) => {
    if (saving || from === to || to < 0 || to >= me.photos.length) return
    setSaving(true)
    void reorderPhotos(from, to)
      .then(() => toast.success(from === 0 || to === 0 ? '照片顺序及头像已更新' : '照片顺序已保存'))
      .catch(err => toast.error(err instanceof Error ? err.message : '照片顺序未保存，请重试'))
      .finally(() => setSaving(false))
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async e => {
          const files = Array.from(e.target.files ?? []).slice(0, 6 - me.photos.length)
          e.target.value = ''
          if (!files.length) return
          if (saving) return
          setSaving(true)
          try {
            const urls = await Promise.all(files.map(f => readImageFile(f, 600, 'profile')))
            await addPhotos(urls)
            toast.success(`已上传 ${urls.length} 张照片,第一张新照片已设为头像`)
          } catch (e) {
            toast.error(e instanceof Error ? e.message : '照片未保存成功,请重试')
          } finally {
            setSaving(false)
          }
        }}
      />
      <div className="grid grid-cols-3 gap-3">
        {me.photos.map((p, i) => (
          <div
            key={p}
            className={cn(
              'group relative aspect-[3/4] overflow-hidden rounded-md border border-border transition',
              dragIdx === i && 'opacity-40',
              overIdx === i && dragIdx !== i && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
            )}
            onDragOver={e => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (overIdx !== i) setOverIdx(i)
            }}
            onDragLeave={() => {
              if (overIdx === i) setOverIdx(null)
            }}
            onDrop={e => {
              e.preventDefault()
              if (dragIdx !== null && dragIdx !== i) movePhoto(dragIdx, i)
              finishDrag()
            }}
          >
            <img
              src={p}
              alt={`照片 ${i + 1}`}
              draggable
              className={cn('h-full w-full cursor-grab object-cover active:cursor-grabbing', dragIdx === i && 'pointer-events-none')}
              onDragStart={e => {
                setDragIdx(i)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(i))
              }}
              onDragEnd={finishDrag}
            />
            <span className="pointer-events-none absolute left-1.5 bottom-1.5 inline-flex items-center gap-0.5 rounded-sm bg-red-ink/60 px-1 py-0.5 text-[10px] text-primary-foreground/80 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
              <GripVertical size={10} />
              拖拽排序
            </span>
            {i === 0 ? (
              <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-sm bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
                <Star size={10} />
                当前头像
              </span>
            ) : (
              <button
                aria-label="设为头像"
                title="设为头像"
                className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-sm bg-red-ink/70 px-1.5 py-0.5 text-[10px] text-primary-foreground opacity-100 transition hover:bg-red-ink md:opacity-0 md:group-hover:opacity-100"
                disabled={saving}
                onClick={() => {
                  if (saving) return
                  setSaving(true)
                  void setAvatar(i)
                    .then(() => toast.success('头像已确认保存,全站同步生效'))
                    .catch(err => toast.error(err instanceof Error ? err.message : '头像未保存,请重试'))
                    .finally(() => setSaving(false))
                }}
              >
                <Star size={10} />
                设为头像
              </button>
            )}
            {me.photos.length > 1 && <div className="absolute bottom-1 right-1 flex gap-1 md:hidden">
              <button aria-label={`将第 ${i + 1} 张照片前移`} className="rounded bg-card/95 p-1 text-primary disabled:opacity-40" disabled={saving || i === 0} onClick={() => movePhoto(i, i - 1)}><ArrowLeft size={15} /></button>
              <button aria-label={`将第 ${i + 1} 张照片后移`} className="rounded bg-card/95 p-1 text-primary disabled:opacity-40" disabled={saving || i >= me.photos.length - 1} onClick={() => movePhoto(i, i + 1)}><ArrowRight size={15} /></button>
            </div>}
            {me.photos.length > 1 && (
              <button
                aria-label="删除照片"
                className="absolute right-1.5 top-1.5 rounded-full bg-red-ink/70 p-1 text-primary-foreground opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
                disabled={saving}
                onClick={() => {
                  if (saving) return
                  setSaving(true)
                  void removePhoto(i)
                    .then(() => toast.success('照片已删除并保存'))
                    .catch(err => toast.error(err instanceof Error ? err.message : '照片未删除,请重试'))
                    .finally(() => setSaving(false))
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {!full && (
          <button
            className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border text-muted-foreground transition hover:border-primary/60 hover:text-primary"
            disabled={saving}
            onClick={() => !saving && inputRef.current?.click()}
          >
            <Camera size={22} />
            <span className="text-xs">上传照片</span>
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">最多 6 张，第一张为头像。电脑端拖拽调整顺序，手机端使用左右箭头调整；所有修改均在服务端确认后生效。{saving ? ' 正在保存…' : ''}</p>
    </div>
  )
}
