import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listRecentBackups } from './release-preflight.mjs'

function withBackupDir(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-release-check-'))
  try { run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
function file(root, name) {
  fs.writeFileSync(path.join(root, name), Buffer.alloc(101, 65))
}

test('release backup gate rejects unrelated database and uploads snapshots', () => withBackupDir(root => {
  file(root, 'db-2026-10-08.json')
  file(root, 'uploads-2026-10-09.tar')
  assert.equal(listRecentBackups(root), false)
}))

test('release backup gate accepts a matching fresh database and uploads pair', () => withBackupDir(root => {
  file(root, 'db-2026-10-08.json')
  file(root, 'uploads-2026-10-08.tar')
  assert.equal(listRecentBackups(root), true)
}))

test('release backup gate rejects stale pairs and missing backup directory', () => withBackupDir(root => {
  file(root, 'db-old.json')
  file(root, 'uploads-old.tar')
  const old = new Date(Date.now() - 49 * 3600_000)
  for (const name of fs.readdirSync(root)) fs.utimesSync(path.join(root, name), old, old)
  assert.equal(listRecentBackups(root), false)
  assert.equal(listRecentBackups(path.join(root, 'missing')), false)
}))
