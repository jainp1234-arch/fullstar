import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installFakes, signInStudio } from './fakes';
import { WIDTHS, WidthName, walk } from './routes';

/** App Flow §7 screen IDs; all in shell E (Guidelines §10). S1 is covered below. */
const EXPECTED = ['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'];
const NAV: Record<WidthName, 'rail' | 'side'> = { phone: 'rail', tablet: 'rail', desktop: 'side' };

for (const [name, size] of Object.entries(WIDTHS) as [WidthName, (typeof WIDTHS)[WidthName]][]) {
  test.describe(`Studio at ${name} width`, () => {
    test.use({ viewport: size });

    test('every screen is reachable by clicking, in shell E with the right navigation', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await signInStudio(page);
      await expect(page).toHaveURL(/\/studio\/dashboard$/);
      const seen = await walk(page);
      expect([...seen.keys()].sort()).toEqual([...EXPECTED].sort());
      for (const id of EXPECTED) {
        const visit = seen.get(id);
        expect(visit?.shell, `${id} shell`).toBe('E');
        expect(visit?.nav, `${id} navigation`).toBe(NAV[name]);
        expect(visit?.path.startsWith('/studio/'), `${id} under /studio/`).toBe(true);
      }
    });
  });
}

test('signed out, Studio screens go to staff sign-in', async ({ page }) => {
  await installFakes(page);
  await page.goto('dashboard');
  await expect(page).toHaveURL(/\/studio\/sign-in$/);
  await expect(page.locator('[data-screen]')).toHaveAttribute('data-screen', 'S1');
  await expect(page.locator('nav')).toHaveCount(0);
});

test('signed in, the top bar shows the staff member and Sign out ends the session', async ({
  page,
}) => {
  await signInStudio(page);
  await expect(page.getByText('Meera · Content admin')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/studio\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('an account without an active staff row is refused', async ({ page }) => {
  await signInStudio(page, { staffDenied: true });
  await expect(page.getByText('This account is not an active staff account.')).toBeVisible();
});

test('Back goes to the parent screen and the mode is studio', async ({ page }) => {
  await signInStudio(page);
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'studio');
  const nav = page.getByRole('navigation', { name: 'Studio' });
  await nav.getByRole('link', { name: 'Library' }).click();
  await page.getByRole('link', { name: 'S5 · Edit and preview' }).click();
  await page.getByRole('link', { name: 'S6 · Publish' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/sample\/edit$/);
  await expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
});

test('the dashboard has no WCAG 2.1 AA violations at desktop and tablet width', async ({
  page,
}) => {
  await signInStudio(page);
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
  for (const size of [WIDTHS.desktop, WIDTHS.tablet]) {
    await page.setViewportSize(size);
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
    ).toEqual([]);
  }
});
