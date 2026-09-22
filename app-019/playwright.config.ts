import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5199',
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  },
  // 本地：用 vite preview 起生产构建；CI/容器验证时用 E2E_BASE_URL 指向 :8099
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run preview',
        port: 5199,
        reuseExistingServer: true,
      },
})
