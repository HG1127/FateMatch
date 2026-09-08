import { useRef, useState } from 'react'
import { Camera, GripVertical, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { readImageFile, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function PhotoManager() {
  const { me, addPhotos, removePhoto, setAvatar, reorderPhotos } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  if (!me) return null
  const full = me.photos.length >= 6

  const finishDrag = () => {
    setDragIdx(null)
    setOverIdx(null)
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
          try {
            const urls = await Promise.all(files.map(f => readImageFile(f, 600)))
            const firstNew = me.photos.length
            addPhotos(urls)
            setAvatar(firstNew)
            toast.success(`已上传 ${urls.length} 张照片,并自动设为头像`)
          } catch {
            toast.error('部分图片读取失败,请换一张')
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
              if (dragIdx !== null && dragIdx !== i) {
                reorderPhotos(dragIdx, i)
                if (dragIdx === 0 || i === 0) toast.success('照片顺序已调整,头像已同步更新')
                else toast('照片顺序已调整')
              }
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
            <span className="pointer-events-none absolute left-1.5 bottom-1.5 inline-flex items-center gap-0.5 rounded-sm bg-red-ink/60 px-1 py-0.5 text-[10px] text-primary-foreground/80 opacity-0 transition group-hover:opacity-100">
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
                className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-sm bg-red-ink/70 px-1.5 py-0.5 text-[10px] text-primary-foreground opacity-0 transition hover:bg-red-ink group-hover:opacity-100"
                onClick={() => {
                  setAvatar(i)
                  toast.success('已设为头像,全站同步生效')
                }}
              >
                <Star size={10} />
                设为头像
              </button>
            )}
            {me.photos.length > 1 && (
              <button
                aria-label="删除照片"
                className="absolute right-1.5 top-1.5 rounded-full bg-red-ink/70 p-1 text-primary-foreground opacity-0 transition group-hover:opacity-100"
                onClick={() => {
                  removePhoto(i)
                  toast('已删除一张照片')
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
            onClick={() => inputRef.current?.click()}
          >
            <Camera size={22} />
            <span className="text-xs">上传照片</span>
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">最多 6 张,第一张为头像;新上传的照片自动成为头像,拖动照片可调顺序,也可把鼠标移到照片上「设为头像」。</p>
    </div>
  )
}
