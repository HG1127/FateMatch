/**
 * The browser calls relative /api/* and /__pb/api/* paths.
 * Vercel must forward them to the independently deployed, isolated Node gateway
 * BEFORE the React SPA fallback. No Neon credentials ever enter the Vite bundle.
 */
export function validateBackendOrigin(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Missing SUIYUAN_BACKEND_ORIGIN (dedicated staging HTTPS API)')
  let url
  try { url = new URL(raw.trim()) } catch { throw new Error('SUIYUAN_BACKEND_ORIGIN must be an absolute HTTPS origin') }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new Error('Backend must be a credential-free HTTPS origin without a path, query or fragment')
  }
  const host = url.hostname.toLowerCase()
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[|\d+\.\d+\.\d+\.\d+$)/.test(host) ||
      /(?:\.localhost|\.local|\.internal|\.invalid|\.example|\.test)$/.test(host) ||
      ['example.com', 'example.org', 'example.net'].includes(host)) {
    throw new Error('Backend must be a real public staging HTTPS hostname, not a local/example address')
  }
  return url.origin
}

export function createVercelSplitConfig(env) {
  if (env.SUIYUAN_DEPLOY_MODE !== 'staging') {
    throw new Error('Vercel preview must explicitly set SUIYUAN_DEPLOY_MODE=staging')
  }
  if ((env.VERCEL_ENV === 'production' || env.VERCEL_TARGET_ENV === 'production') &&
      env.SUIYUAN_ALLOW_PRODUCTION_TARGET !== 'yes') {
    throw new Error('Refusing to deploy staging app to Vercel production target without explicit approval')
  }
  const upstream = validateBackendOrigin(env.SUIYUAN_BACKEND_ORIGIN)
  const privateHeaders = [
    { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
    { key: 'x-vercel-enable-rewrite-caching', value: '0' },
  ]
  return {
    framework: 'vite',
    buildCommand: 'node scripts/vercel-build.mjs',
    outputDirectory: 'dist',
    rewrites: [
      { source: '/__pb/:path*', destination: `${upstream}/__pb/:path*` },
      { source: '/api/:path*', destination: `${upstream}/api/:path*` },
      { source: '/:path*', destination: '/index.html' },
    ],
    headers: [
      { source: '/__pb/:path*', headers: privateHeaders },
      { source: '/api/:path*', headers: privateHeaders },
      // This prevents indexing, but must NOT be treated as authentication.
      { source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }] },
    ],
  }
}
