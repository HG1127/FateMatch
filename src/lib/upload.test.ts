// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pb } from './pb'
import { uploadImage } from './upload'

afterEach(() => vi.restoreAllMocks())

describe('独立版签名图片上传地址', () => {
  it('只使用本站 /api/uploads 接口并返回同源签名 URL', async () => {
    const signedPath = '/api/uploads/v2-profile-example-123456789012345678901234.webp?sig=token-test'
    const send = vi.spyOn(pb, 'send').mockResolvedValue({ url: signedPath } as never)

    await expect(uploadImage('data:image/webp;base64,aGVsbG8=', 'profile'))
      .resolves.toBe(`${window.location.origin}${signedPath}`)

    expect(send).toHaveBeenCalledWith('/api/uploads', {
      method: 'POST',
      body: { image: 'data:image/webp;base64,aGVsbG8=', purpose: 'profile' },
    })
  })

  it('拒绝外部绝对地址和非上传接口', async () => {
    const send = vi.spyOn(pb, 'send')
    send.mockResolvedValue({ url: 'https://untrusted.example.com/image.webp' } as never)
    await expect(uploadImage('data:a', 'post')).rejects.toThrow(/不是本站上传接口/)
    send.mockResolvedValue({ url: '/api/collections/users/records' } as never)
    await expect(uploadImage('data:a', 'post')).rejects.toThrow(/不是本站上传接口/)
  })

  it('上传无 URL 时不得伪称成功', async () => {
    vi.spyOn(pb, 'send').mockResolvedValue({} as never)
    await expect(uploadImage('data:a', 'chat')).rejects.toThrow(/图片未上传成功/)
  })
})
