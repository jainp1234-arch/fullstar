import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /(pwa-offline|studio-routes)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4200' },
    },
    {
      // Content Studio dev server under its base href (Plan 2.3 routes)
      name: 'studio',
      testMatch: /studio-routes\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4201/studio/' },
    },
    {
      // Production build with the service worker (Plan 2.1: fonts load offline)
      name: 'pwa',
      testMatch: /pwa-offline\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4300' },
    },
  ],
  webServer: [
    {
      command: 'npx ng serve family-app --port 4200',
      url: 'http://localhost:4200',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'npx ng serve content-studio --host 127.0.0.1 --port 4201',
      url: 'http://127.0.0.1:4201/studio/',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command:
        'npx ng build family-app && node scripts/serve-static.mjs dist/family-app/browser 4300',
      url: 'http://127.0.0.1:4300',
      reuseExistingServer: !process.env['CI'],
      timeout: 240_000,
    },
  ],
});
