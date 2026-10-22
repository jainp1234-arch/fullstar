import { defineConfig, devices } from '@playwright/test';

// Projects named with --project / -p (all projects when none), so only their dev servers start
function selectedProjects(argv: readonly string[]): Set<string> | null {
  const names = new Set<string>();
  argv.forEach((arg, i) => {
    const next = argv[i + 1];
    if (arg.startsWith('--project=')) {
      names.add(arg.slice('--project='.length));
    } else if ((arg === '--project' || arg === '-p') && next) {
      names.add(next);
    }
  });
  return names.size > 0 ? names : null;
}

const selected = selectedProjects(process.argv);
const needed = (...projects: string[]): boolean =>
  selected === null || projects.some((name) => selected.has(name));

type WebServer = {
  command: string;
  url: string;
  reuseExistingServer: boolean;
  timeout: number;
};

const servers: Array<{ projects: string[]; server: WebServer }> = [
  {
    // The real project reaches this dev server through Caddy
    projects: ['chromium', 'real'],
    server: {
      command: 'npx ng serve family-app --port 4200',
      url: 'http://localhost:4200',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  },
  {
    projects: ['studio'],
    server: {
      command: 'npx ng serve content-studio --host 127.0.0.1 --port 4201',
      url: 'http://127.0.0.1:4201/studio/',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  },
  {
    projects: ['pwa'],
    server: {
      command:
        'npx ng build family-app && node scripts/serve-static.mjs dist/family-app/browser 4300',
      url: 'http://127.0.0.1:4300',
      reuseExistingServer: !process.env['CI'],
      timeout: 240_000,
    },
  },
];

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
      testIgnore: /(pwa-offline|studio-[a-z-]+|real-sign-in|csp-headers)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4200' },
    },
    {
      // Content Studio dev server under its base href (Plan 2.3 routes)
      name: 'studio',
      testMatch: /studio-[a-z-]+\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4201/studio/' },
    },
    {
      // Opt-in real sign-in through Caddy, Keycloak and the API (Plan 2.4); needs make up, api, family
      name: 'real',
      testMatch: /real-sign-in\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8080' },
    },
    {
      // Opt-in (Plan 9.2): the production builds behind Caddy's CSP, in the ZAP stack on :8088
      name: 'csp',
      testMatch: /csp-headers\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8088' },
    },
    {
      // Production build with the service worker (Plan 2.1: fonts load offline)
      name: 'pwa',
      testMatch: /pwa-offline\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4300' },
    },
  ],
  webServer: servers.filter(({ projects }) => needed(...projects)).map(({ server }) => server),
});
