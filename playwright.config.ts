import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// (PW_PORT lets two checkouts run their browser tests side by side without sharing a server)
const PORT = Number(process.env.PW_PORT ?? 4173);
/**
 * Our relay, run here (`relay/`, when its packages are installed: `pnpm -C relay install`): the
 * tests in e2e/relay.spec.ts go through it, as phones do on the real site.
 */
const RELAY = existsSync('relay/node_modules/.bin/wrangler');

/**
 * Browser tests (`pnpm test:e2e`): every game dealt at phone, laptop and TV sizes, checked for
 * anything off-screen or any error. They run against the dev server in local mode (`?net=local`:
 * tabs in one browser link up directly, no network needed).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  // (CI's runners have four cores: one is left for the dev server)
  workers: process.env.CI ? 3 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // a failing test leaves a screenshot of what it saw (uploaded by CI)
    screenshot: 'only-on-failure',
    // (a cloud container may provide its own Chromium build)
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
  projects: [
    // (the screen audit and the pictures only when asked for: left in, skipped, they'd still count when
    // CI splits the tests into equal parts, and one part would be mostly tests that don't run)
    {
      name: 'dev',
      testIgnore: new RegExp(
        `(${['csp', 'offline', ...(process.env.AUDIT ? [] : ['audit']), ...(process.env.PICTURES ? [] : ['pictures'])].join('|')})\\.spec`,
      ),
      use: { baseURL: `http://localhost:${PORT}` },
    },
    // the production build, served with the headers the real site sends (public/_headers)
    { name: 'production', testMatch: /(csp|offline)\.spec/, use: { baseURL: `http://localhost:${PORT + 1}` } },
    // Safari's engine (most of the phones at the table are iPhones): the flows people go through,
    // not every game at every size. In CI, or locally with PW_WEBKIT=1 (and WebKit installed).
    ...(process.env.CI || process.env.PW_WEBKIT
      ? [
          {
            name: 'webkit',
            testMatch: /(lobby|table|rejoin|handOrder|a11y|scores|invite|homeTip|safearea|spreadMelds|dummy|hints|freeTable)\.spec/,
            use: { browserName: 'webkit' as const, baseURL: `http://localhost:${PORT}`, launchOptions: {} },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: `pnpm exec vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm build && node e2e/serve-dist.mjs ${PORT + 1}`,
      url: `http://localhost:${PORT + 1}`,
      // (always a fresh build: an old one would test old code)
      reuseExistingServer: false,
      timeout: 180_000,
    },
    ...(RELAY
      ? [
          {
            command: `pnpm -C relay exec wrangler dev --port ${PORT + 2} --ip 127.0.0.1 --inspector-port ${PORT + 3} --show-interactive-dev-session=false`,
            url: `http://127.0.0.1:${PORT + 2}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
