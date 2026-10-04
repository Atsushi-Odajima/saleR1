import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use a locally provided Chromium when present (CI sandbox); otherwise `npx playwright install chromium`.
const exe = process.env.KOEITO_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const launchOptions = exe ? { executablePath: exe } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    launchOptions,
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 }, launchOptions }, testIgnore: /electron\.spec\.ts/ },
    { name: 'electron', testMatch: /electron\.spec\.ts/ },
  ],
});
