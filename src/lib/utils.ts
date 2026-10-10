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


/**
 * 客户端异常仅记在浏览器控制台。旧 /__err Vite 插件会把堆栈拼在 URL，
 * 可能携带用户信息；独立版不再向服务器传输和持久化这类内容。
 */
export function reportErr(tag: string, e: unknown) {
  if (import.meta.env.DEV) {
    console.error('[随缘网] 前端异常', tag, e)
  } else {
    console.error('[随缘网] 页面运行异常', tag)
  }
}