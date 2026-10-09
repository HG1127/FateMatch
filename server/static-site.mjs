// Standalone production mode: serve Vite dist without exposing a development server.
// All API/auth/media authorization continues to run in neon-gateway.mjs.
import fs from 'node:fs'
import path from 'node:path'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

function sendNotFound(res) {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end('Not found')
}

export function isWithinDirectory(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
}

export function createStaticSiteHandler({ directory }) {
  const root = path.resolve(directory)
  const actualRoot = fs.realpathSync(root)
  const indexFile = path.join(root, 'index.html')
  if (!fs.existsSync(indexFile) || !fs.statSync(indexFile).isFile()) {
    throw new Error('缺少生产页面 dist/index.html，请先运行 pnpm build')
  }

  // BrowserRouter runs at "/" in standalone mode, independent of VibeX subpath mode.
  // <base> also makes "./assets/..." work after refreshing /matches/ or /me/.
  const html = fs.readFileSync(indexFile, 'utf8')
  const indexBody = Buffer.from(
    /<base\s/i.test(html) ? html : html.replace(/<head([^>]*)>/i, '<head$1><base href="/">'),
  )
  const commonHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  }

  return function handleStatic(req, res, requestPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    if (requestPath === '/api' || requestPath.startsWith('/api/') ||
        requestPath === '/__pb' || requestPath.startsWith('/__pb/')) return false

    let decoded = ''
    try {
      decoded = decodeURIComponent(requestPath)
    } catch {
      sendNotFound(res)
      return true
    }

    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(segment => segment === '..' || segment.startsWith('.'))) {
      sendNotFound(res)
      return true
    }

    const candidate = path.resolve(root, '.' + decoded)
    if (!isWithinDirectory(root, candidate)) {
      sendNotFound(res)
      return true
    }

    let file = null
    let stat = null
    try {
      stat = fs.statSync(candidate)
      // Disallow a symlink beneath dist from resolving to files outside dist.
      if (stat.isFile() && isWithinDirectory(actualRoot, fs.realpathSync(candidate))) file = candidate
    } catch {
      // A direct asset miss must not return SPA HTML (which would break script loading).
    }

    if (!file) {
      const explicitFile = decoded.startsWith('/assets/') ||
        /\/[^/]+\.[^/]+$/.test(decoded) || decoded.startsWith('/.')
      if (explicitFile) {
        sendNotFound(res)
        return true
      }
      res.writeHead(200, {
        ...commonHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': indexBody.byteLength,
        'Cache-Control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : indexBody)
      return true
    }

    if (file === indexFile) {
      res.writeHead(200, {
        ...commonHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': indexBody.byteLength,
        'Cache-Control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : indexBody)
      return true
    }

    const type = CONTENT_TYPES[path.extname(file).toLowerCase()]
    if (!type) {
      sendNotFound(res)
      return true
    }
    res.writeHead(200, {
      ...commonHeaders,
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': decoded.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    })
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
    return true
  }
}
