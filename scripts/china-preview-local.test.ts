// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readChinaStagingConfig } from './china-preview-local.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatematch-china-staging-tests-'))
afterAll(() => fs.rmSync(root,{force:true,recursive:true}))
const fn = suffix => path.join(root, suffix + '.local')
const staging = 'postgresql://suiyuan_staging_owner:sample-not-real@ep-demo.ap-southeast-1.aws.neon.tech/suiyuan_staging?sslmode=require'
const production = 'postgresql://prod_user:sample-not-real@ep-demo.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
const save = (name, dsn=staging, schema='staging_render_preview', enabled='1') => {
  const file=fn(name)
  fs.writeFileSync(file,['NEON_DSN='+dsn,'NEON_SCHEMA='+schema,'STAGING_MODE='+enabled].join('\n'))
  return file
}
describe('国内本地全栈模式：拒绝任何非专用 Staging 库',()=>{
  it('明确接受专用 role/database/schema 但不发起真实连接',()=>{
    const c=readChinaStagingConfig(save('staging'))
    expect(c.STAGING_MODE).toBe('1')
    expect(c.NEON_SCHEMA).toBe('staging_render_preview')
  })
  it('测试凭据未创建时停止，而不自动读开发环境现有生产凭据',()=>{
    expect(()=>readChinaStagingConfig(fn('missing'))).toThrow(/缺少 china-staging.local/)
  })
  it('即使 schema 是 staging 也拒绝正式数据库',()=>{
    expect(()=>readChinaStagingConfig(save('prod',production))).toThrow(/禁止生产数据库/)
  })
  it('拒绝 public、其他 staging schema 和关闭安全开关',()=>{
    expect(()=>readChinaStagingConfig(save('public',staging,'public'))).toThrow(/必须使用/)
    expect(()=>readChinaStagingConfig(save('other',staging,'staging_shared'))).toThrow(/必须使用/)
    expect(()=>readChinaStagingConfig(save('unsafe',staging,'staging_render_preview','0'))).toThrow(/必须使用/)
  })
  it('拒绝在配置文件里混入不受支持的配置或重复密钥',()=>{
    const f=save('extra')
    fs.appendFileSync(f,'\nHOST=0.0.0.0\n')
    expect(()=>readChinaStagingConfig(f)).toThrow(/不受支持/)
    const f2=save('duplicate')
    fs.appendFileSync(f2,'\nNEON_SCHEMA=staging_render_preview\n')
    expect(()=>readChinaStagingConfig(f2)).toThrow(/重复/)
  })
  it('配置文件格式错误立即拒绝',()=>{
    fs.writeFileSync(fn('broken'),'NEON_DSN')
    expect(()=>readChinaStagingConfig(fn('broken'))).toThrow(/不合法/)
  })
})
