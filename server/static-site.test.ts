import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStaticSiteHandler, isWithinDirectory } from './static-site.mjs'

const tempDirs = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suiyuan-static-test-'))
  tempDirs.push(root)
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'index.html'),
    '<!doctype html><html><head><title>随缘网</title><script src="./assets/main-12345678.js"></script></head><body><div id="root"></div></body></html>')
  fs.writeFileSync(path.join(root, 'assets', 'main-12345678.js'), 'console.log("ready")')
  fs.writeFileSync(path.join(root, 'assets', 'main-12345678.css'), 'body{margin:0}')
  return { root, handler: createStaticSiteHandler({ directory: root }) }
}

function request(handler, pathname, method = 'GET') {
  let code = 0
  let headers = {}
  let payload = ''
  const res = {
    writeHead(status, values) { code = status; headers = values },
    end(value = '') { payload += Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '') },
    destroy() { throw new Error('stream unexpectedly destroyed') },
  }
  const handled = handler({ method }, res, pathname)
  return { handled, response: res, status: () => code, headers: () => headers, body: () => payload }
}

describe('生产静态站点边界', () => {
  it('没有 dist/index.html 时拒绝作为正式站点启动', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suiyuan-static-empty-'))
    tempDirs.push(root)
    expect(() => createStaticSiteHandler({ directory: root })).toThrow(/pnpm build/)
  })
  it('根目录与路由深链返回正确 HTML，并带根 base', () => {
    const { handler } = setup()
    for (const route of ['/', '/me', '/matches/', '/events/real-1', '/auth']) {
      const response = request(handler, route)
      expect(response.handled).toBe(true)
      expect(response.status()).toBe(200)
      expect(response.body()).toContain('<base href="/">')
      expect(response.headers()['Cache-Control']).toBe('no-store')
    }
  })
  it('API 与 PocketBase 代理路径绝不被 SPA 路由劫持', () => {
    const { handler } = setup()
    for (const route of ['/api/health', '/api/unknown', '/__pb/api/health', '/__pb']) {
      expect(request(handler, route).handled).toBe(false)
    }
  })
  it('缺失资产、非法编码、路径穿越、敏感文件均返回 404 而不是 index', () => {
    const { handler } = setup()
    for (const route of ['/assets/missing.js', '/.env', '/.git/config', '/%00', '/assets/%2e%2e%5csecret', '/bad%zz']) {
      const response = request(handler, route)
      expect(response.handled).toBe(true)
      expect(response.status()).toBe(404)
      expect(response.body()).not.toContain('<html')
    }
    expect(isWithinDirectory('/a/public', '/a/publicity/secret')).toBe(false)
  })
  it('dist 内的符号链接不能越过真实目录读取外部文件', () => {
    const { root, handler } = setup()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'suiyuan-static-outside-'))
    tempDirs.push(outside)
    const secret = path.join(outside, 'leaked.js')
    fs.writeFileSync(secret, 'secret-do-not-read')
    try {
      fs.symlinkSync(secret, path.join(root, 'assets', 'linked.js'))
    } catch (e) {
      // Windows without Developer Mode may deny symlinks; validation remains active in code.
      if (e.code === 'EPERM' || e.code === 'EACCES') return
      throw e
    }
    const response = request(handler, '/assets/linked.js')
    expect(response.status()).toBe(404)
    expect(response.body()).not.toContain('secret-do-not-read')
  })

  it('不接受 POST 页面；HEAD 不发送 HTML 正文', () => {
    const { handler } = setup()
    expect(request(handler, '/me', 'POST').handled).toBe(false)
    const head = request(handler, '/matches/', 'HEAD')
    expect(head.status()).toBe(200)
    expect(head.body()).toBe('')
  })
})
