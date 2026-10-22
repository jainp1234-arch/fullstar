import { expect, test } from '@playwright/test';

/**
 * Plan 9.3 (decided 22 Oct 2026, replacing the Lighthouse PWA score that Lighthouse 12 removed):
 * the production family app is installable. Chrome reports no installability error, the manifest
 * has the name, colours and the 192/512 icons (also maskable), and the service worker takes control.
 * Starting offline is covered by pwa-offline.spec.ts.
 */
interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose: string;
}

test('Chrome can install the app: manifest, icons and service worker', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: ManifestIcon[];
  };
  expect(manifest).toMatchObject({
    name: 'FullStar',
    short_name: 'FullStar',
    start_url: './',
    display: 'standalone',
    theme_color: '#2A0C5E',
    background_color: '#2A0C5E',
  });
  for (const size of ['192x192', '512x512']) {
    for (const purpose of ['any', 'maskable']) {
      expect(manifest.icons).toContainEqual(expect.objectContaining({ sizes: size, purpose }));
    }
  }
  for (const icon of manifest.icons) {
    const png = await (await page.request.get(icon.src)).body();
    // PNG header: width and height at bytes 16-23
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
  }

  // Registration waits for the app to be stable; then the worker controls the next load
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), undefined, {
    timeout: 60_000,
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 30_000,
  });

  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
});
