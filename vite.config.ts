// 随缘网独立版：Vite 只提供开发服务器和本机 API 代理。
// 生产站点由 Node 网关提供 /api 与 React 静态文件。
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const localGateway = process.env.LOCAL_GATEWAY_URL ?? 'http://127.0.0.1:7000'
const localFullstackProxy = process.env.LOCAL_FULLSTACK === '1'
  ? {
      '/api': { target: localGateway, changeOrigin: true },
      // 迁移期兼容旧页面；新前端直接访问 /api。
      '/__pb': {
        target: localGateway,
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/__pb/, ''),
      },
    }
  : undefined

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '127.0.0.1',
    port: 8000,
    strictPort: !localFullstackProxy,
    ...(localFullstackProxy ? { proxy: localFullstackProxy } : {}),
  },
  preview: {
    host: '127.0.0.1',
    port: 8000,
    ...(localFullstackProxy ? { proxy: localFullstackProxy } : {}),
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    pool: 'threads',
    fileParallelism: false,
    isolate: false,
  },
})
