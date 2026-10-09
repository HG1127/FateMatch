// Playwright 发布冒烟专用页面服务：固定 7300，并把 /__pb 代理到隔离网关 7200。
// 由 Playwright webServer 生命周期管理，不读取/写入数据库密钥。
import process from 'node:process'
import { createServer } from 'vite'

process.env.LOCAL_FULLSTACK = '1'
process.env.LOCAL_GATEWAY_URL = process.env.E2E_GATEWAY_URL ?? 'http://127.0.0.1:7200'

const server = await createServer({
  server: {
    host: '127.0.0.1',
    port: 7300,
    strictPort: true,
  },
  logLevel: 'warn',
})

await server.listen()
console.log('[e2e-web] 页面服务已就绪：http://127.0.0.1:7300')

let closing = false
async function shutdown(code = 0) {
  if (closing) return
  closing = true
  try {
    await server.close()
  } finally {
    process.exit(code)
  }
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
