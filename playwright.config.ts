import { defineConfig } from '@playwright/test'

// 发布冒烟：一次性隔离 Neon schema + 正式构建的同源 React/API 网关（7200）。
// 不再额外启动 7300 Vite 开发服务，避免与实际生产构建产生双服务竞态。
// 运行：pnpm e2e。需要本地 NEON_DSN 或本机忽略文件，自动启动并清理测试网关。
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  globalSetup: './e2e/global-setup.mjs',
  globalTeardown: './e2e/global-teardown.mjs',
  use: {
    baseURL: 'http://127.0.0.1:7200',
  },
  reporter: [['list']],
})
