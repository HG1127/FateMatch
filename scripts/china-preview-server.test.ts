// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, request as httpRequest } from 'node:http'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createChinaPreviewServer, newPreviewToken, validPreviewToken } from './china-preview-server.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fatematch-china-preview-test-'))
fs.mkdirSync(path.join(tmp, 'assets'))
fs.writeFileSync(path.join(tmp, 'index.html'), '<html><body>Mobile preview</body></html>')
fs.writeFileSync(path.join(tmp, 'assets', 'main.js'), 'const mobile = true')
const secret = { accessPassword: randomBytes(27).toString('base64url'), sessionKey: randomBytes(32).toString('hex') }
let backend, gateway, base
const localPort = server => server.address().port
const cookie = () => '__Host-fatematch-preview=' + newPreviewToken(secret)
const get = (url, opts={}) => fetch(base+url,{redirect:'manual',...opts})

beforeAll(async()=>{
  backend = createServer(async(req,res)=>{
    if(req.url==='/api/ready'){
      res.setHeader('Content-Type','application/json')
      res.end(JSON.stringify({ok:true,cookieReceived:!!req.headers.cookie,authorization:req.headers.authorization??null}))
      return
    }
    res.setHeader('Content-Type','application/json')
    res.end(JSON.stringify({path:req.url,method:req.method}))
  })
  backend.listen(0,'127.0.0.1')
  await once(backend,'listening')
  gateway=createChinaPreviewServer({secret,upstream:'http://127.0.0.1:'+localPort(backend),staticDir:tmp})
  gateway.listen(0,'127.0.0.1')
  await once(gateway,'listening')
  base='http://127.0.0.1:'+localPort(gateway)
})
afterAll(async()=>{
  gateway?.closeAllConnections()
  backend?.closeAllConnections()
  await Promise.all([new Promise(resolve=>gateway?.close(resolve)),new Promise(resolve=>backend?.close(resolve))])
  fs.rmSync(tmp,{recursive:true,force:true})
})

describe('免费隧道后面的本地 Staging 安全入口',()=>{
  it('站点和静态脚本都不可匿名访问',async()=>{
    for(const route of ['/','/matches?with=test','/assets/main.js']){
      const res=await get(route)
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toContain('/_preview/login')
    }
    const api=await get('/api/ready')
    expect(api.status).toBe(401)
  })
  it('错误口令不会发放认证 Cookie',async()=>{
    const res=await get('/_preview/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'passcode=wrong'})
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
  it('认证后深链接与前端资源正常服务',async()=>{
    const login=await get('/_preview/login?next=%2Fmatches',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({passcode:secret.accessPassword}).toString(),
    })
    expect(login.status).toBe(303)
    expect(login.headers.get('location')).toBe('/matches')
    expect(login.headers.get('set-cookie')).toMatch(/Secure; HttpOnly; SameSite=Lax/)
    const c=login.headers.get('set-cookie').split(';')[0]
    expect((await (await get('/matches?with=test',{headers:{Cookie:c}})).text())).toContain('Mobile preview')
    expect((await (await get('/assets/main.js',{headers:{Cookie:c}})).text())).toContain('mobile = true')
  })
  it('透传会员 JWT 到 Staging，但预览私密 Cookie 不发给后端',async()=>{
    const r=await get('/api/ready',{headers:{Cookie:cookie(),Authorization:'synthetic-member-token'}})
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ok:true,cookieReceived:false,authorization:'synthetic-member-token'})
    expect(r.headers.get('cache-control')).toContain('no-store')
  })
  it('免费预览禁止照片写入',async()=>{
    const r=await get('/api/uploads',{method:'POST',headers:{Cookie:cookie()},body:'image'})
    expect(r.status).toBe(403)
  })
  it('不允许攻击者借 Host 头跨站访问',async()=>{
    // fetch() rewrites Host. Use raw Node HTTP to test the actual request Host.
    const result = await new Promise((resolve,reject)=>{
      const u = new URL(base)
      const request = httpRequest({hostname:u.hostname,port:u.port,path:'/',headers:{
        Host:'malicious.example.com',Cookie:cookie(),
      }},response=>{response.resume();response.on('end',()=>resolve(response.statusCode))})
      request.on('error',reject)
      request.end()
    })
    expect(result).toBe(421)
  })
  it('阻止隐藏文件与目录遍历',async()=>{
    const r=await get('/%2eenv',{headers:{Cookie:cookie()}})
    expect(r.status).toBe(403)
  })
  it('服务端口令会过期且不可篡改',()=>{
    const token=newPreviewToken(secret)
    expect(validPreviewToken(secret,token)).toBe(true)
    expect(validPreviewToken(secret,token.slice(0,-2)+'aa')).toBe(false)
    expect(validPreviewToken(secret,token,Date.now()+9*3600*1000)).toBe(false)
  })
})
