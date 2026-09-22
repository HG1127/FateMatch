import { defineConfig } from '@playwright/test'

// 发布冒烟：API 全链路跑在一次性隔离 schema 的网关实例上（不碰生产数据），
// UI 启动检查跑在 8000 页面服务上（只读）。
// 运行：NEON_DSN='postgresql://…' npx playwright test
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
