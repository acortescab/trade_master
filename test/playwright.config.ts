import { defineConfig, devices } from '@playwright/test';

// The app (single container or local uvicorn) must already be running with LLM_MOCK=true.
// All specs share one backend (one portfolio, one watchlist), so they run serially.
const baseURL = process.env.BASE_URL ?? 'http://localhost:8000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    { name: 'api', testMatch: /api\.spec\.ts$/ },
    {
      name: 'ui',
      testIgnore: /api\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
  ],
});
