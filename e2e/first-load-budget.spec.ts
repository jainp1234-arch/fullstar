import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { signInFamily } from './fakes';

/**
 * Plan 9.3: the family (kid) app's first load is at most 300 KB compressed (decided 22 Oct 2026:
 * everything the first screen downloads: index.html, start-up JS and CSS, fonts and images it
 * uses). Production build, service worker blocked so its background prefetch does not count.
 * Sizes are gzip level 9 of each file, as the hosting compresses them (brotli is smaller).
 */
const BUDGET = 300 * 1024;

test.use({ serviceWorkers: 'block' });

async function firstLoad(page: Page, path: string): Promise<{ total: number; files: string[] }> {
  const origin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:4300').origin;
  const sizes = new Map<string, number>();
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin) {
      return;
    }
    // The API and Keycloak are not part of the app's download
    if (response.request().method() !== 'GET' || /^\/(api|auth)\//.test(url.pathname)) {
      return;
    }
    const body = await response.body().catch(() => null);
    if (body) {
      const compressed = /\.(woff2|webp|png|jpe?g)$/.test(url.pathname)
        ? body.length
        : gzipSync(body, { level: 9 }).length;
      sizes.set(url.pathname, compressed);
    }
  });
  await page.goto(path, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const files = [...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file, size]) => `${(size / 1024).toFixed(1)} KB ${file}`);
  return { total, files };
}

test('a first visit (Welcome) loads at most 300 KB compressed', async ({ page }) => {
  const { total, files } = await firstLoad(page, '/');
  console.log(`Welcome first load ${(total / 1024).toFixed(1)} KB\n  ${files.join('\n  ')}`);
  expect(total, files.join('\n')).toBeLessThanOrEqual(BUDGET);
});

test('a signed-in family opening the app (Who is learning?) loads at most 300 KB', async ({
  page,
}) => {
  await signInFamily(page);
  await page.goto('about:blank');
  const { total, files } = await firstLoad(page, '/who');
  console.log(`Who first load ${(total / 1024).toFixed(1)} KB\n  ${files.join('\n  ')}`);
  expect(total, files.join('\n')).toBeLessThanOrEqual(BUDGET);
});
