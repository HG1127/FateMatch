// A fully synthetic browser regression for mobile UI, without any database credentials.
// Starts local Vite Preview and mocks /api/* in the browser; never connects to Neon.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chromium } from '@playwright/test'
import fs from 'node:fs'

// Each test run owns a different loopback port, so parallel checks cannot
// mistake another run's temporary preview for their own and then lose it.
async function reservePreviewPort() {
  const listener = createServer()
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  return port
}
const port = await reservePreviewPort()
const origin = `http://127.0.0.1:${port}`
for (const size of [192, 512]) {
  const png = fs.readFileSync(`public/icons/icon-${size}.png`)
  assert(png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), `icon-${size} is PNG`)
  assert(png.readUInt32BE(16) === size && png.readUInt32BE(20) === size, `icon-${size} has correct dimensions`)
}
const installManifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'))
assert(installManifest.name === '随缘网' && installManifest.display === 'standalone' &&
  installManifest.start_url === '/', 'Mobile homescreen manifest is isolated to root')
const sizes = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
]
const now = Date.now()
const profiles = [
  { id: 'p1', sid: 'mobile-me', nickname: '手机体验甲', gender: 'female', seeking: 'male',
    birth_date: '1994-01-01', city: '杭州', region: '浙江省·杭州市', job: '产品设计', bio: '喜欢阅读和徒步',
    interests: ['阅读', '徒步'], photos: ['/favicon.svg'], verification: { phone: false, realname: false, photo: false }, created_at: now },
  { id: 'p2', sid: 'mobile-peer', nickname: '手机体验乙', gender: 'male', seeking: 'female',
    birth_date: '1993-01-01', city: '杭州', region: '浙江省·杭州市', job: '工程师', bio: '喜欢旅行',
    interests: ['阅读', '徒步'], photos: ['/favicon.svg'], verification: { phone: false, realname: false, photo: false }, created_at: now },
]
const likes = [
  { id: 'like1', sid: 'like1', owner_sid: 'mobile-me', target_sid: 'mobile-peer' },
  { id: 'like2', sid: 'like2', owner_sid: 'mobile-peer', target_sid: 'mobile-me' },
]
const settings = [{ id: 's1', sid: 'main', features: { yuanfen: true, explore: true, events: true, community: true, matches: true },
  stories: [], announcement: '', hidden_events: [], fest_templates: {} }]

const jwt = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, id: 'mobile-me' })).toString('base64url'),
  'synthetic-mobile-only',
].join('.')
const account = { token: jwt, record: { id: 'mobile-me', email: 'mobile@synthetic.test',
  name: '手机体验甲', collectionName: 'users', collectionId: 'users' } }

function collectionPage(items) {
  return { page: 1, perPage: 200, totalItems: items.length, totalPages: items.length ? 1 : 0, items }
}
function mockApi(pathname, params) {
  if (pathname === '/api/profiles/lookup') {
    const ids = (params.get('ids') ?? '').split(',')
    return { items: profiles.filter(row => ids.includes(row.sid)) }
  }
  if (pathname === '/api/chats/summaries')
    return { items: [{ otherId: 'mobile-peer', lastAt: now - 1000, lastFrom: 'mobile-peer', lastText: '今晚一起散步吗？', unread: 1 }] }
  if (/^\/api\/chats\/[^/]+\/messages$/.test(pathname))
    return { items: [{ id: 'msg1', recordId: 'record1', from: 'mobile-peer', text: '今晚一起散步吗？',
      at: now - 60_000, images: [], recalled: false }] }
  if (pathname.startsWith('/api/me/relationship-feedback/'))
    return { available: true, eligible: true, outcome: null }
  if (pathname === '/api/me/activity-stats')
    return { joinedEvents: 0, ownPosts: 0, lastCommentAt: 0 }
  if (pathname === '/api/events/list' || pathname === '/api/discovery/profiles' || pathname === '/api/community/posts')
    return collectionPage([])
  if (pathname === '/api/community/digests') return []
  if (pathname === '/api/ready') return { code: 200, message: 'API is ready.', data: { ready: true } }
  if (pathname.startsWith('/api/collections/')) {
    const col = pathname.split('/')[3]
    return collectionPage(col === 'user_likes' ? likes : col === 'site_settings' ? settings : col === 'profiles' ? profiles : [])
  }
  if (pathname.startsWith('/api/')) return { items: [] }
  return null
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
async function registerMocks(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1') return route.abort('blockedbyclient')
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const body = mockApi(url.pathname, url.searchParams)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body ?? {}) })
  })
}
async function checkWidth(page, screen, label) {
  const m = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  assert(Math.max(m.doc, m.body) <= m.viewport + 2, `${screen.width}px ${label}: horizontal overflow ${JSON.stringify(m)}`)
}
async function startPreview() {
  const child = spawn(process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdio: 'ignore', windowsHide: true })
  for (let n = 0; n < 70; n++) {
    if (child.exitCode !== null) throw new Error('Vite preview stopped early')
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(1800) })
      if (res.ok) return child
    } catch { /* wait */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  child.kill('SIGTERM')
  throw new Error('Vite preview did not start')
}

const child = await startPreview()
let browser
try {
  browser = await chromium.launch({ headless: true })
  const manifestResponse = await fetch(origin + '/manifest.webmanifest')
  assert(manifestResponse.ok && (await manifestResponse.json()).display === 'standalone',
    'Built mobile manifest is served by the standalone website')
  const iconResponse = await fetch(origin + '/icons/icon-192.png')
  assert(iconResponse.ok && iconResponse.headers.get('content-type')?.includes('image/png'),
    'Built homescreen PNG is served with the correct content type')
  for (const screen of sizes) {
    const option = { viewport: screen, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    const guest = await browser.newContext(option)
    await registerMocks(guest)
    const pg = await guest.newPage()
    const errors = []
    pg.on('pageerror', error => errors.push(error.message))
    for (const path of ['/', '/auth', '/auth?mode=register', '/trust']) {
      await pg.goto(origin + path, { waitUntil: 'domcontentloaded' })
      await checkWidth(pg, screen, path)
      if (path.startsWith('/auth') && screen.width < 1024) {
        const fontSize = await pg.getByLabel('邮箱', { exact: true }).evaluate(el => getComputedStyle(el).fontSize)
        assert(fontSize === '16px', `${screen.width}px email input may trigger iOS zoom: ${fontSize}`)
      }
    }
    if (screen.width < 768) {
      await pg.getByRole('button', { name: '打开更多功能' }).click()
      await pg.getByRole('dialog', { name: '发现更多' }).waitFor({ state: 'visible' })
      await pg.getByRole('button', { name: '关闭更多功能菜单' }).click()
      assert(await pg.getByRole('dialog').count() === 0, 'Guest mobile sheet did not close')
    }
    assert(!errors.length, `${screen.width}px guest page error: ${errors.join('; ')}`)
    await guest.close()

    const logged = await browser.newContext(option)
    await registerMocks(logged)
    await logged.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      { key: 'pb_auth_local', value: account })
    const page = await logged.newPage()
    const memberErrors = []
    page.on('pageerror', error => memberErrors.push(error.message))
    await page.goto(origin + '/matches', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('会话列表').getByRole('button', { name: /打开与手机体验乙的聊天/ }).waitFor({ timeout: 25000 })
    await checkWidth(page, screen, 'inbox')
    if (screen.width < 768) {
      const nav = page.getByRole('navigation', { name: '手机主导航' })
      await nav.waitFor()
      const links = await nav.getByRole('link').all()
      for (const link of links) {
        const height = await link.evaluate(el => el.getBoundingClientRect().height)
        assert(height >= 44, `${screen.width}px bottom tab target too small: ${height}`)
      }
      await page.getByRole('button', { name: '打开更多功能' }).click()
      await page.getByRole('navigation', { name: '手机更多功能' }).getByRole('link', { name: /兴趣筛选/ }).waitFor()
      await page.getByRole('button', { name: '关闭更多功能菜单' }).click()
    }

    await page.getByLabel('会话列表').getByRole('button', { name: /打开与手机体验乙的聊天/ }).click()
    await page.waitForURL(/\?with=mobile-peer/, { timeout: 25000 })
    await page.getByRole('textbox', { name: '聊天消息草稿' }).waitFor({ state: 'visible' })
    await checkWidth(page, screen, 'chat')
    if (screen.width < 1024) {
      const bounds = await page.locator('[data-mobile-chat-panel]').evaluate(el => {
        const rect = el.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight }
      })
      if (bounds.bottom > bounds.viewport + 2) {
        const ancestry = await page.locator('[data-mobile-chat-panel]').evaluate(element => {
          const results = []
          for (let n = element; n && n !== document.body; n = n.parentElement) {
            const box = n.getBoundingClientRect()
            results.push({ tag: n.tagName, classes: typeof n.className === 'string' ? n.className.slice(0, 115) : '',
              display: getComputedStyle(n).display, top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height) })
          }
          return { scrollY: window.scrollY, innerHeight: window.innerHeight, ancestry: results }
        })
        console.log('CHAT_LAYOUT_DIAG', screen.width, JSON.stringify(ancestry))
      }
      assert(bounds.bottom <= bounds.viewport + 2,
        `${screen.width}px chat composer extends beyond viewport: ${JSON.stringify(bounds)}`)
    }
    if (screen.width < 768) {
      assert(await page.getByRole('navigation', { name: '手机主导航' }).count() === 0,
        'Bottom navigation should hide in mobile conversation')
      await page.getByRole('button', { name: '快捷回复' }).click()
      // Even with auxiliary quick replies expanded, the actual send button stays tappable.
      const send = await page.getByRole('button', { name: '发送', exact: true }).evaluate(el => {
        const box = el.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, viewport: window.innerHeight, height: box.height }
      })
      assert(send.top >= 0 && send.bottom <= send.viewport + 2 && send.height >= 44,
        `${screen.width}px send button is clipped or too small: ${JSON.stringify(send)}`)
      const optionButton = page.getByRole('button', { name: /你周末一般怎么过/ })
      await optionButton.waitFor({ state: 'visible' })
      await optionButton.click()
      const draft = await page.getByRole('textbox', { name: '聊天消息草稿' }).inputValue()
      assert(draft.includes('你周末'), 'Quick reply did not populate draft')
      await page.getByRole('button', { name: '返回会话列表' }).click()
      await page.waitForURL(/\/matches$/, { timeout: 15000 })
      await page.getByRole('navigation', { name: '手机主导航' }).waitFor()
    }

    await page.goto(origin + '/me', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '打理自己的缘' }).waitFor({ timeout: 22000 })
    await checkWidth(page, screen, 'me')
    if (screen.width < 768) {
      const nickname = page.getByLabel('昵称', { exact: true })
      await nickname.focus()
      await page.getByRole('navigation', { name: '手机主导航' }).waitFor({ state: 'hidden' })
      await nickname.evaluate(el => el.blur())
      await page.getByRole('navigation', { name: '手机主导航' }).waitFor({ state: 'visible' })
    }
    if (screen.width < 768) {
      await page.getByRole('navigation', { name: '我的快捷操作' }).getByRole('link', { name: '编辑基本资料' }).click()
      assert(new URL(page.url()).hash === '#profile-editor', 'Profile shortcut did not reach editor')
    }

    await page.goto(origin + '/events', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: '同席之缘' }).waitFor({ timeout: 20000 })
    await checkWidth(page, screen, 'events')
    assert(!memberErrors.length, `${screen.width}px logged-in page error: ${memberErrors.join('; ')}`)
    console.log(`PASS mobile UI ${screen.width}×${screen.height} (guest, menu, inbox, chat, profile, events)`)
    await logged.close()
  }
  console.log('PASS all mobile layouts with fully synthetic API; no Neon credentials or network writes.')
} finally {
  await browser?.close()
  child.kill('SIGTERM')
}
