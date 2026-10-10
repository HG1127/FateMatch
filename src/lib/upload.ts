import { pb, getPocketBaseUrl } from './pb'

export type UploadPurpose = 'profile' | 'post' | 'event' | 'chat' | 'admin'

/**
 * 压缩图必须真实上传成功后才能进入业务数据；返回带 HMAC capability 的 URL。
 * 不再在上传失败时把 dataURL 静默塞回数据库。
 */
export async function uploadImage(dataUrl: string, purpose: UploadPurpose): Promise<string> {
  const out = (await pb.send('/api/uploads', { method: 'POST', body: { image: dataUrl, purpose } })) as { url?: string }
  if (!out?.url) throw new Error('图片未上传成功')
  // 只接受自建网关生成的同源签名图片路径，避免意外跳到外部存储主机。
  if (!out.url.startsWith('/api/uploads/')) throw new Error('图片地址不是本站上传接口')
  return new URL(out.url, getPocketBaseUrl()).toString()
}
