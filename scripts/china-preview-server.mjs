// Private China mobile preview: local React build + proxied isolated Render Staging API.
// Never send member data or Neon credentials to this script; the access password
// and cookie signing key remain in a Git-ignored local file.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const STAGING_ORIGIN = 'https://suiyuan-staging-api.onrender.com'
const SECRET_FILE = path.join(ROOT, 'china-preview.local')
const COOKIE = '__Host-fatematch-preview'
const SESSION_AGE = 8 * 3600
const LIMIT = 1024 * 1024

export function loadOrCreatePreviewSecrets(file = SECRET_FILE) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({
      accessPassword: randomBytes(25).toString('base64url'),
      sessionKey: randomBytes(32).toString('hex'),
    }, null, 2), { flag: 'wx', mode: 0o600 })
  }
  const secret = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (typeof secret.accessPassword !== 'string' || secret.accessPassword.length < 25 ||
      !/^[a-f0-9]{64}$/.test(secret.sessionKey)) throw new Error('本机预览访问密钥不合法')
  return secret
}
function sha(x) { return createHash('sha256').update(String(x)).digest() }
function samePassword(a, b) { return timingSafeEqual(sha(a), sha(b)) }
function signature(key, exp, nonce) {
  return createHmac('sha256', key).update('v1.' + exp + '.' + nonce).digest('hex')
}
export function newPreviewToken(secret, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + SESSION_AGE
  const nonce = randomBytes(12).toString('hex')
  return ['v1', expiry, nonce, signature(secret.sessionKey, expiry, nonce)].join('.')
}
export function validPreviewToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 160) return false
  const segments = token.split('.')
  if (segments.length !== 4 || segments[0] !== 'v1' ||
      !/^\d{10,12}$/.test(segments[1]) || !/^[a-f0-9]{24}$/.test(segments[2]) ||
      !/^[a-f0-9]{64}$/.test(segments[3])) return false
  const expiry = Number(segments[1]), seconds = Math.floor(now / 1000)
  if (expiry < seconds || expiry > seconds + SESSION_AGE + 30) return false
  return timingSafeEqual(Buffer.from(segments[3]), Buffer.from(signature(secret.sessionKey, expiry, segments[2])))
}
function cookieValue(token, age = SESSION_AGE) {
  return COOKIE + '=' + token + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + age
}
function cookieRead(raw) {
  return String(raw ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) ?? ''
}
function nextPath(value) {
  const x = String(value || '/')
  return x.startsWith('/') && !x.startsWith('//') && !x.includes('\\') &&
    !x.includes('\r') && !x.includes('\n') && !x.startsWith('/_preview/') ? x : '/'
}
function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
}
function loginPage(next, error = '') {
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="robots" content="noindex,nofollow"><title>随缘网 · 移动测试</title>',
    '<style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#faf7f1;color:#37262c;padding:20px;font-family:system-ui,-apple-system,"PingFang SC",sans-serif}',
    'main{width:min(100%,420px);border-radius:22px;border:1px solid #e5d7c7;background:#fffdfa;padding:28px 22px;box-shadow:0 24px 50px #59202b1a}',
    '.seal{display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:#812c3b;color:#f4dfaa;font-size:29px}',
    'h1{font-size:25px;margin:19px 0 8px}p{font-size:14px;line-height:1.7;color:#68585b}',
    'label{display:block;margin:24px 0 10px;font-size:14px;font-weight:650}input{height:52px;width:100%;border:1px solid #c9b7aa;border-radius:10px;padding:0 13px;font-size:17px}',
    'button{width:100%;height:50px;border:0;border-radius:10px;margin-top:17px;background:#812c3b;color:white;font-size:16px;font-weight:700}',
    '.warning{padding:9px 12px;border-radius:8px;background:#fff1f1;color:#a22b2b}',
    '</style></head><body><main><div class="seal" aria-hidden="true">缘</div>',
    '<h1>随缘网 · 移动端预览</h1><p>仅限授权测试。此处使用独立 Staging 数据库，请只填合成测试资料，禁止上传真实会员信息。</p>',
    error ? '<p class="warning" role="alert">' + esc(error) + '</p>' : '',
    '<form method="POST" action="/_preview/login?next=' + encodeURIComponent(nextPath(next)) + '">',
    '<label for="passcode">测试访问口令</label><input id="passcode" name="passcode" type="password" autocomplete="off" required maxlength="150" placeholder="输入保存在电脑里的临时口令">',
    '<button type="submit">进入随缘网</button></form>',
    '<p>免费临时入口需要提供测试的电脑保持运行；不要分享口令或网站给陌生人。</p>',
    '</main></body></html>',
  ].join('')
}
function securityHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options','DENY')
  res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=()')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
}
function sendJSON(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'})
  res.end(JSON.stringify(data))
}
function sendHTML(res, status, content) {
  res.writeHead(status, {'Content-Type':'text/html; charset=utf-8'})
  res.end(content)
}
function redirect(res, where) {
  res.writeHead(303, {'Location':where})
  res.end()
}
function validHost(raw) {
  const host = String(raw ?? '').split(':')[0].toLowerCase()
  return host==='127.0.0.1' || host==='localhost' || ['.trycloudflare.com','.cpolar.top','.cpolar.cn','.cpolar.io','.cpolar.com'].some(s=>host.endsWith(s)&&host.length>s.length)
}
async function readBody(req,max=LIMIT) {
  const chunks=[]
  let bytes=0
  for await (const c of req) {
    bytes+=c.length
    if(bytes>max) throw new Error('TOO_LARGE')
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}
const MIME = {
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
  '.woff':'font/woff','.woff2':'font/woff2',
}
function serveStatic(req,res,u,root) {
  if (!['GET','HEAD'].includes(req.method)) return sendJSON(res,405,{message:'只支持 GET/HEAD'})
  let name
  try {name=decodeURIComponent(u.pathname)} catch {return sendJSON(res,400,{message:'路径无效'})}
  if (!name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').some(seg=>seg.startsWith('.'))) return sendJSON(res,403,{message:'拒绝非法路径'})
  const absolute=path.resolve(root,'.'+name)
  if (absolute!==root && !absolute.startsWith(root+path.sep)) return sendJSON(res,403,{message:'路径不在静态目录'})
  let file=absolute
  try {if (!fs.statSync(file).isFile()) file=path.join(root,'index.html')}
  catch {if(path.extname(name))return sendJSON(res,404,{message:'资源不存在'});file=path.join(root,'index.html')}
  res.writeHead(200, {'Content-Type':MIME[path.extname(file).toLowerCase()]??'application/octet-stream'})
  if (req.method==='HEAD')return res.end()
  const stream=fs.createReadStream(file)
  stream.on('error',()=>res.destroy())
  stream.pipe(res)
}
async function proxyAPI(req,res,u,upstream) {
  if (/^\/api\/uploads(?:\/|$)/.test(u.pathname) && !['GET','HEAD'].includes(req.method)) return sendJSON(res,403,{message:'免费预览环境禁止图片上传'})
  const headers = new Headers()
  for (const name of ['authorization','content-type','accept','range','if-none-match']) {
    const val=req.headers[name]
    if(typeof val==='string' && val.length<=8192)headers.set(name,val)
  }
  let body
  if (!['GET','HEAD'].includes(req.method)) {
    try{body=await readBody(req)}catch{return sendJSON(res,413,{message:'请求超过 1MB 测试限制'})}
  }
  let reply
  try{
    reply=await fetch(new URL(u.pathname+u.search,upstream),{
      method:req.method,headers,body:body?.length?body:undefined,
      redirect:'manual',signal:AbortSignal.timeout(90000),
    })
  }catch{return sendJSON(res,503,{message:'测试后端不可访问或免费实例正在启动，请稍后重试'})}
  if(reply.status>=300 && reply.status<400) return sendJSON(res,502,{message:'API 被意外重定向'})
  for(const key of ['content-type','etag','content-range','content-disposition']){
    const v=reply.headers.get(key)
    if(v)res.setHeader(key,v)
  }
  res.statusCode=reply.status
  if(req.method==='HEAD'||reply.status===204||reply.status===304){res.end();await reply.body?.cancel();return}
  const bytes=Buffer.from(await reply.arrayBuffer())
  if(bytes.length>5*1024*1024)return sendJSON(res,502,{message:'API 响应过大'})
  res.end(bytes)
}
export function createChinaPreviewServer({secret,upstream=STAGING_ORIGIN,staticDir=path.join(ROOT,'dist')}) {
  if (!secret || secret.accessPassword?.length<25 || !/^[a-f0-9]{64}$/.test(secret.sessionKey??''))throw new Error('访问密钥无效')
  const root=path.resolve(staticDir)
  if(!fs.existsSync(path.join(root,'index.html')))throw new Error('dist 尚未构建：请先 pnpm build')
  const failures=new Map()
  return http.createServer((req,res)=>{
    const run=async()=>{
      securityHeaders(res)
      if(!validHost(req.headers.host))return sendJSON(res,421,{message:'未授权 Host'})
      let u
      try{u=new URL(req.url??'/','http://preview.local')}catch{return sendJSON(res,400,{message:'无效路径'})}
      if(u.pathname==='/_preview/health')return sendJSON(res,200,{ok:true,staging:true,protected:true})
      const authorized=validPreviewToken(secret,cookieRead(req.headers.cookie))
      if(u.pathname==='/_preview/login'&&req.method==='GET'){
        return authorized?redirect(res,nextPath(u.searchParams.get('next'))):sendHTML(res,200,loginPage(u.searchParams.get('next')))
      }
      if(u.pathname==='/_preview/login'&&req.method==='POST'){
        const addr=req.socket.remoteAddress??'unknown'
        const now=Date.now()
        const attempts=(failures.get(addr)??[]).filter(x=>now-x<60000)
        failures.set(addr,attempts)
        if(attempts.length>=8)return sendHTML(res,429,loginPage(u.searchParams.get('next'),'访问口令尝试次数过多，请稍候。'))
        let data
        try{data=await readBody(req,2048)}catch{return sendHTML(res,413,loginPage('/','请求长度异常'))}
        attempts.push(now)
        if(!samePassword(new URLSearchParams(data.toString()).get('passcode')??'',secret.accessPassword))return sendHTML(res,401,loginPage(u.searchParams.get('next'),'访问口令不正确'))
        failures.delete(addr)
        res.setHeader('Set-Cookie',COOKIE+'='+newPreviewToken(secret)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+SESSION_AGE)
        return redirect(res,nextPath(u.searchParams.get('next')))
      }
      if(u.pathname==='/_preview/logout'&&req.method==='POST'){
        res.setHeader('Set-Cookie',COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0')
        return redirect(res,'/_preview/login')
      }
      if(!authorized){
        if(u.pathname.startsWith('/api/'))return sendJSON(res,401,{message:'需先输入访问口令'})
        return redirect(res,'/_preview/login?next='+encodeURIComponent(nextPath(u.pathname+u.search)))
      }
      if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/__pb/api/')){
        if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(req.method))return sendJSON(res,405,{message:'不支持的方法'})
        return proxyAPI(req,res,u,upstream)
      }
      return serveStatic(req,res,u,root)
    }
    void run().catch(()=>{if(!res.headersSent)sendJSON(res,500,{message:'临时测试网关内部错误'});else res.destroy()})
  })
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.SUIYUAN_CHINA_PREVIEW_PORT??8611)
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('本地端口不合法')
  const secret=loadOrCreatePreviewSecrets()
  const server=createChinaPreviewServer({secret})
  server.listen(port,'127.0.0.1',()=>{
    console.log('[china-preview] 本机已启动 http://127.0.0.1:'+port)
    console.log('[china-preview] 私密口令位于 Git 忽略文件 china-preview.local（不输出口令）')
    console.log('[china-preview] 固定指向隔离 Render Staging 后端；禁止真实个人信息/照片')
  })
  process.on('SIGINT',()=>server.close())
  process.on('SIGTERM',()=>server.close())
}
