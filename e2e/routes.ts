import { Page, expect } from '@playwright/test';

/** Guidelines §13 breakpoints. */
export const WIDTHS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 800, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;

export type WidthName = keyof typeof WIDTHS;

export interface Visit {
  readonly id: string;
  readonly path: string;
  readonly shell: string;
  readonly nav: 'bottom' | 'rail' | 'side' | 'none';
}

/** Which navigation is on screen: the first visible variant. */
async function visibleNav(page: Page): Promise<Visit['nav']> {
  for (const variant of ['bottom', 'rail', 'side'] as const) {
    if (await page.locator(`nav.nav--${variant}`).isVisible()) {
      return variant;
    }
  }
  return 'none';
}

async function readScreen(page: Page): Promise<Visit> {
  await expect(page.locator('.ph__id')).toHaveText(/\S/);
  const id = (await page.locator('.ph__id').textContent())?.trim() ?? '';
  await expect(page.locator('h1:visible'), `${id} has one heading`).toHaveCount(1);
  const shell = (await page.locator('[data-shell]').getAttribute('data-shell')) ?? '';
  return { id, path: new URL(page.url()).pathname, shell, nav: await visibleNav(page) };
}

/**
 * Depth-first walk of every screen reachable by clicking placeholder links and navigation,
 * going back through history after each branch. Returns every screen seen, by ID.
 */
export async function walk(page: Page, start: string): Promise<Map<string, Visit>> {
  const seen = new Map<string, Visit>();
  const seenPaths = new Set<string>();

  async function visit(): Promise<void> {
    const here = await readScreen(page);
    seen.set(here.id, here);
    seenPaths.add(here.path);
    const hrefs = await page
      .locator('a.ph__link:visible, nav a:visible')
      .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).pathname));
    for (const href of [...new Set(hrefs)]) {
      if (seenPaths.has(href)) {
        continue;
      }
      await page.locator(`a[href$="${href}"]:visible`).first().click();
      await expect(page).toHaveURL((url) => url.pathname === href);
      // Links always lead to another screen; wait until it has rendered
      await expect(page.locator('.ph__id')).not.toHaveText(here.id);
      await visit();
      await page.goBack();
      await expect(page).toHaveURL((url) => url.pathname === here.path);
      await expect(page.locator('.ph__id')).toHaveText(here.id);
    }
  }

  await page.goto(start);
  await visit();
  return seen;
}
