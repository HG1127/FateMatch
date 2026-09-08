import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtTime(at: number): string {
  const d = new Date(at)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`
}


/** 读取图片并压缩到最长边 700, 控制本地存储占用 */
export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read fail'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode fail'))
      img.onload = () => {
        const max = 700
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}


/** 把前端运行时错误上报到服务日志, 便于排查预览白屏 */
export function reportErr(tag: string, e: unknown) {
  try {
    const err = e as Error & { componentStack?: string }
    const stack = err && err.stack ? err.stack.split('\n').slice(0, 10).join(' / ') : ''
    const comp = err && err.componentStack ? err.componentStack.split('\n').slice(0, 8).join(' > ') : ''
    const msg = `${err && err.message ? err.message : String(e)} | ${stack} | COMP:${comp}`
    fetch(`./__err?m=${encodeURIComponent(`[${tag}] ${msg}`.slice(0, 3800))}`).catch(() => {})
  } catch {
    /* ignore */
  }
}
