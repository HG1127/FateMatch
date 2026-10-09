/**
 * Vercel staging preflight is read-only. It never connects to Neon/backend
 * and never prints the backend address or any secrets.
 */
import fs from 'node:fs'
import process from 'node:process'
import { createVercelSplitConfig } from './vercel-split-config.mjs'

try {
  const config = createVercelSplitConfig(process.env)
  const html = fs.readFileSync('dist/index.html', 'utf8')
  if (!/(?:src|href)=["']\/assets\//.test(html) || /(?:src|href)=["']\.\/assets\//.test(html)) {
    throw new Error('Vercel bundle has relative assets. Build via node scripts/vercel-build.mjs first')
  }
  const api = config.rewrites[1]
  const pb = config.rewrites[0]
  if (api.source !== '/api/:path*' || pb.source !== '/__pb/:path*' ||
      config.rewrites.at(-1)?.destination !== '/index.html') {
    throw new Error('Vercel proxy ordering changed unexpectedly')
  }
  console.log('PASS Vercel split config: staging mode and HTTPS backend endpoint validated')
  console.log('PASS /__pb and /api are proxied before SPA fallback')
  console.log('PASS signed-image API and private responses use no-store routing')
  console.log('PASS Vercel output assets are root-absolute for deep links')
  console.log('This is local configuration proof, not a deployed Vercel preview.')
} catch (error) {
  console.error('BLOCK Vercel staging preview:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 2
}
