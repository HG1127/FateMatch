import { pb, getPocketBaseUrl } from './pb'

/**
 * 把压缩后的图片 dataURL 上传到网关落盘，返回可直接用于 <img src> 的 URL（v1.8）。
 * 数据库不再存大体积 dataURL；文件名不可猜测，凭 URL 访问。
 * 失败抛错，由调用方决定回退（readImageFile 会回退为内联 dataURL，功能不中断）。
 */
export async function uploadImage(dataUrl: string): Promise<string> {
  const out = (await pb.send('/api/uploads', { method: 'POST', body: { image: dataUrl } })) as { url?: string }
  if (!out?.url) throw new Error('upload failed')
  return `${getPocketBaseUrl()}${out.url}`
}
