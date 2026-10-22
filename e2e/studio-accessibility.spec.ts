import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { signInStudio } from './fakes';
import { Visit, navigateInApp, walk } from './routes';

/**
 * Plan 9.4: every Studio screen (S1–S12) at desktop width has no WCAG 2.1 AA violation, and at
 * 200% zoom (640×400) no screen scrolls sideways.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function walkStudio(page: Page, onVisit: (p: Page, visit: Visit) => Promise<void>) {
  await signInStudio(page);
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
  const seen = await walk(page, [], new Map(), onVisit);
  // S5 opens from a library row; the fake API has a lesson with id "sample"
  await navigateInApp(page, '/studio/library/sample/edit');
  await walk(page, [], seen, onVisit);
  return seen;
}

test('every Studio screen has no WCAG 2.1 AA violations at desktop width', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const problems: string[] = [];
  const seen = await walkStudio(page, async (p, visit) => {
    await p.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page: p }).withTags(AXE_TAGS).analyze();
    for (const v of results.violations) {
      problems.push(`${visit.id} ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
    }
  });
  expect(seen.size).toBeGreaterThanOrEqual(11);
  expect(problems).toEqual([]);
});

test('Studio sign-in (S1) has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('sign-in');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('every Studio screen reflows at 200% zoom', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 640, height: 400 });
  const problems: string[] = [];
  await walkStudio(page, async (p, visit) => {
    const overflow = await p.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    if (overflow > 1) {
      problems.push(`${visit.id} scrolls sideways by ${overflow}px`);
    }
  });
  expect(problems).toEqual([]);
});
