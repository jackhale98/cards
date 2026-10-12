import { defineConfig } from '@playwright/test';

// (PW_PORT lets two checkouts run their browser tests side by side without sharing a server)
const PORT = Number(process.env.PW_PORT ?? 4173);

/**
 * Browser tests (`pnpm test:e2e`): every game dealt at phone, laptop and TV sizes, checked for
 * anything off-screen or any error. They run against the dev server in local mode (`?net=local`:
 * tabs in one browser link up directly, no network needed).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // a failing test leaves a screenshot of what it saw (uploaded by CI)
    screenshot: 'only-on-failure',
    // (a cloud container may provide its own Chromium build)
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
