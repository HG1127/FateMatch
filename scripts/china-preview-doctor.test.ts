// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
const json=JSON.parse(fs.readFileSync('package.json','utf8'))
describe('China preview startup cannot silently fall back to Render-only frontend',()=>{
  it('default entry launches guarded local Staging all-in-one, not remote Render proxy',()=>{
    expect(json.scripts['china:preview']).toContain('scripts/china-preview-local.mjs')
    expect(json.scripts['china:preview']).not.toContain('china-preview-server.mjs')
  })
  it('local mode available explicitly and old Render-only mode is labeled diagnostic',()=>{
    expect(json.scripts['china:preview:local']).toBe(json.scripts['china:preview'])
    expect(json.scripts['china:preview:render']).toContain('china-preview-server.mjs')
    expect(json.scripts['china:doctor']).toContain('china-preview-doctor.mjs')
  })
})
