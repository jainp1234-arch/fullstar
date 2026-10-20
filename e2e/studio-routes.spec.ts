import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { WIDTHS, WidthName, walk } from './routes';

/** App Flow §7 screen IDs; all in shell E (Guidelines §10). */
const EXPECTED = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'];
const NAV: Record<WidthName, 'rail' | 'side'> = { phone: 'rail', tablet: 'rail', desktop: 'side' };

for (const [name, size] of Object.entries(WIDTHS) as [WidthName, (typeof WIDTHS)[WidthName]][]) {
  test.describe(`Studio at ${name} width`, () => {
    test.use({ viewport: size });

    test('every screen is reachable by clicking, in shell E with the right navigation', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const seen = await walk(page, 'sign-in');
      expect([...seen.keys()].sort()).toEqual([...EXPECTED].sort());
      for (const id of EXPECTED) {
        const visit = seen.get(id);
        expect(visit?.shell, `${id} shell`).toBe('E');
        expect(visit?.nav, `${id} navigation`).toBe(id === 'S1' ? 'none' : NAV[name]);
        expect(visit?.path.startsWith('/studio/'), `${id} under /studio/`).toBe(true);
      }
    });
  });
}

test('Back goes to the parent screen and the mode is studio', async ({ page }) => {
  await page.goto('library/sample/publish');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'studio');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/sample\/edit$/);
  const nav = page.getByRole('navigation', { name: 'Studio' }).first();
  await expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
});

test('the dashboard has no WCAG 2.1 AA violations at desktop and tablet width', async ({
  page,
}) => {
  for (const size of [WIDTHS.desktop, WIDTHS.tablet]) {
    await page.setViewportSize(size);
    await page.goto('dashboard');
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
    ).toEqual([]);
  }
});
