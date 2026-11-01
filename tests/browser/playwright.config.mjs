import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  forbidOnly: true,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4317', browserName: 'chromium' },
  projects: [320, 390, 1280].map(width => ({
    name: `chromium-${width}`,
    use: { viewport: { width, height: 900 } },
  })),
  webServer: {
    command: 'npm start -- --port 4317',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
