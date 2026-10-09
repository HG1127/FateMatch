import { uploadImage } from './upload'
import type { UploadPurpose } from './upload'

/**
 * 统一图片读取/压缩/上传入口。
 * 兼容 readImageFile(file, purpose) 与 readImageFile(file, maxPx, purpose) 两种调用。
 */
export function readImageFile(
  file: File,
  maxOrPurpose: number | UploadPurpose = 700,
  purpose: UploadPurpose = 'event',
): Promise<string> {
  const max = typeof maxOrPurpose === 'number' ? maxOrPurpose : 700
  const uploadPurpose = typeof maxOrPurpose === 'string' ? maxOrPurpose : purpose
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read fail'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode fail'))
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('canvas fail'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }).then(dataUrl => uploadImage(dataUrl, uploadPurpose))
}
