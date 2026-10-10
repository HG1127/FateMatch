// Read-only guard for the VibeX-free standalone frontend. Does not access Neon or cloud providers.
import fs from 'node:fs'
import process from 'node:process'

function read(path) {
  if (!fs.existsSync(path)) throw new Error('Missing required standalone file: ' + path)
  return fs.readFileSync(path, 'utf8')
}
function assert(test, why) {
  if (!test) throw new Error(why)
  console.log('PASS ' + why)
}

try {
  const vite = read('vite.config.ts')
  const pb = read('src/lib/pb.ts')
  const auth = read('src/lib/pb-auth.ts')
  const page = read('index.html')
  const html = read('dist/index.html')
  const manifest = JSON.parse(read('package.json'))
  const legacy = read('scripts/legacy/pocketbase-to-neon-sync.mjs')
  const server = read('server/neon-gateway.mjs')

  assert(!/rhSourcePlugin|data-rh-src|\.runninghub\.cn|\.vibex\.cn/.test(vite), 'Vite has no VibeX visual plugin or platform allowlist')
  assert(vite.includes("base: '/'") && vite.includes("'/api':"), 'Standalone Vite builds at / and proxies local /api')
  assert(!/matchVibexPrefix|app-preview|\/__pb/.test(pb) && pb.includes('window.location.origin'), 'Browser SDK connects to the same-origin Node API')
  assert(auth.includes('Authorization') && !/PB_USER_AUTH_HEADER|return isDirectPbHostName/.test(auth), 'Auth uses standard Authorization')
  assert(page.includes('href="/app-icon.svg"') && fs.existsSync('public/app-icon.svg'), 'Site favicon is served locally')
  assert(page.includes('href="/manifest.webmanifest"'), 'Mobile app manifest is linked locally')
  const appManifest = JSON.parse(read('public/manifest.webmanifest'))
  assert(appManifest.start_url === '/' && appManifest.scope === '/' &&
    appManifest.display === 'standalone' && fs.existsSync('public/icons/icon-192.png') &&
    fs.existsSync('public/icons/icon-512.png'), 'Installable homescreen icon assets are present')
  assert(!/vibex\.runninghub\.cn|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(page + html), 'HTML loads neither VibeX nor Google Fonts domains')
  assert(/(?:src|href)=["']\/assets\//.test(html), 'Built assets are root-absolute, including deep links')
  assert(['@babel/parser','@babel/traverse','@types/babel__traverse','magic-string'].every(k=>!Object.hasOwn(manifest.devDependencies,k)), 'VibeX JSX instrumentation dependencies removed')
  assert(!fs.existsSync('.rh/active-template.json') && !fs.existsSync('.rh/pages/home.md'), 'VibeX design metadata excluded from independent branch')
  assert(legacy.includes("if (!DRY) throw new Error("), 'Legacy full-table migration write mode disabled by default')
  assert(server.includes("url.pathname.startsWith('/__pb/api/')") && server.includes("req.headers['x-pb-auth']"), 'Server retains legacy API alias for rollback compatibility')

  console.log('Standalone preflight verified locally; no deployment, no database writes.')
} catch (error) {
  console.error('BLOCK standalone preflight:', error instanceof Error ? error.message : 'unexpected error')
  process.exitCode = 2
}
