import { expect, test } from '@playwright/test';

/** Plan 2.1: fonts load offline (production build, family-app service worker). */
test('fonts load from the service worker cache when offline', async ({ page, context }) => {
  await page.goto('/');
  // Wait until the service worker controls the page and has cached every prefetched file
  const prefetched: string[] = await page.evaluate(async () => {
    const config = await (await fetch('/ngsw.json?ngsw-bypass=true')).json();
    return config.assetGroups.find((group: { name: string }) => group.name === 'app').urls;
  });
  expect(prefetched.filter((url) => url.endsWith('.woff2'))).toHaveLength(5);
  await page.waitForFunction(
    async (urls) => {
      if (!navigator.serviceWorker.controller) {
        return false;
      }
      const cached = new Set<string>();
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) {
          cached.add(new URL(request.url).pathname);
        }
      }
      if (!urls.every((url) => cached.has(url))) {
        return false;
      }
      // Angular's service worker reports when it is fully initialised and serving from cache
      const state = await (await fetch('/ngsw/state')).text();
      return state.includes('Driver state: NORMAL');
    },
    prefetched,
    { timeout: 60_000, polling: 500 },
  );

  // One online navigation through the service worker binds the page to the cached app version
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 30_000,
  });

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = [...document.fonts].filter(
      (face) => face.family.includes('Poppins') || face.family.includes('Material Symbols Rounded'),
    );
    await Promise.allSettled(faces.map((face) => face.load()));
    return faces.map((face) => `${face.family.replaceAll('"', '')} ${face.weight} ${face.status}`);
  });

  expect(fonts).toHaveLength(5);
  for (const face of fonts) {
    expect(face).toMatch(/ loaded$/);
  }
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
