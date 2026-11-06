import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests: a real browser (phone-sized Chromium) drives the app against a fake backend (e2e/mockApi.ts)
 * whose answers follow the admin API contract. They run in CI on every pull request.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:4174',
    trace: 'retain-on-failure',
    timezoneId: 'Asia/Kolkata',
  },
  webServer: {
    command: 'npx vite build --mode e2e && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
