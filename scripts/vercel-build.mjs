// Vercel frontend build only. Preserve relative base for VibeX development/source exports.
import { spawnSync } from 'node:child_process'
import process from 'node:process'

for (const args of [['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build']]) {
  const out = spawnSync(process.execPath, args, {
    cwd: process.cwd(), env: { ...process.env, SUIYUAN_VERCEL_FRONTEND: '1' },
    stdio: 'inherit', windowsHide: true,
  })
  if (out.error) { console.error('[vercel-build] command could not launch:', out.error.code); process.exit(1) }
  if (out.status !== 0) process.exit(out.status ?? 1)
}
