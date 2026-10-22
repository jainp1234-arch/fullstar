import { BrowserContext, Page, Route } from '@playwright/test';

/** The fake API answers even offline (page.route), so offline also fails every API call. */
const API = /\/api\/v1\//;
const disconnected = (route: Route) => route.abort('internetdisconnected');

/** Plan 9.3: screens load in the background after the first one; wait until all are in. */
export async function screensLoaded(page: Page): Promise<void> {
  await page.locator('html[data-screens-loaded]').waitFor({ state: 'attached', timeout: 30_000 });
}

export async function goOffline(page: Page, context: BrowserContext): Promise<void> {
  await screensLoaded(page);
  await context.setOffline(true);
  await page.route(API, disconnected);
}

/** Removes only that handler: unroute without one would drop the fake API too. */
export async function goOnline(page: Page, context: BrowserContext): Promise<void> {
  await page.unroute(API, disconnected);
  await context.setOffline(false);
}
