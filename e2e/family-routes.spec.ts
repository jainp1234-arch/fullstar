import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { enterPin, signInFamily, unlockParent } from './fakes';
import { WIDTHS, WidthName, navigateInApp, walk } from './routes';

/**
 * App Flow §4–§6 screen IDs and their shells (Guidelines §10), walked signed in. A1 (signed out
 * only) and A3 (the sign-in return, which moves on at once) are covered in family-auth.spec.ts.
 */
const SHELLS: Record<string, readonly string[]> = {
  A: ['C1', 'K1', 'K2', 'K8', 'K12'],
  B: [
    'K3',
    ...['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P8a', 'P9', 'P10'],
    ...['P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19'],
  ],
  C: [
    ...['A2', 'A4', 'B1', 'B2', 'B3', 'B4'],
    ...['K4', 'K5', 'K6', 'K9', 'K10', 'K11', 'K13', 'P0'],
  ],
  D: ['B5', 'K7', 'K14'],
};
const EXPECTED = Object.entries(SHELLS).flatMap(([shell, ids]) => ids.map((id) => ({ id, shell })));
const NAV: Record<WidthName, 'bottom' | 'rail'> = {
  phone: 'bottom',
  tablet: 'rail',
  desktop: 'rail',
};

for (const [name, size] of Object.entries(WIDTHS) as [WidthName, (typeof WIDTHS)[WidthName]][]) {
  test.describe(`family app at ${name} width`, () => {
    test.use({ viewport: size });

    test('every screen is reachable by clicking, in the right shell and navigation', async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await signInFamily(page);
      // Kid mode needs a picked child and parent mode the PIN, both in memory: no reloads
      const seen = await walk(page);
      await page.getByRole('button', { name: 'Asha' }).click();
      await walk(page, [], seen);
      // K3 opens read-along only for book chapters and worksheets arrive in Phase 7 (Plan 6.1)
      for (const path of ['/kid/read-along/sample', '/kid/worksheet/sample', '/kid/well-done']) {
        await navigateInApp(page, path);
        await walk(page, [], seen);
      }
      await navigateInApp(page, '/kid/learn');
      await page.getByRole('button', { name: 'Parent mode' }).click();
      await walk(page, [], seen);
      await enterPin(page);
      await expect(page).toHaveURL(/\/parent\/progress$/);
      await walk(page, [], seen);
      // P14 opens these with buttons, not links
      for (const path of [
        '/parent/settings/children/child-asha',
        '/parent/settings/help',
        '/parent/settings/privacy',
        // P4 opens the book screens with buttons (Plan 5.1)
        '/parent/books/english/upload',
        '/parent/books/english/add-chapter',
        '/parent/books/english/chapters',
        '/parent/books/english/fix-pages',
        '/parent/books/english/preview',
        '/parent/books/english/replace',
        // P18 opens from a P13 question button (Plan 7.3)
        '/parent/report',
        // P1 is real (Plan 6.4): reading history arrives with Phase 7; the bell opens P19
        '/parent/progress/reading',
        // With no worksheets yet, P10 offers Create as a button (Plan 7.2)
        '/parent/worksheets/new',
        '/parent/worksheets/sample/print',
        '/parent/worksheets/sample/solutions',
        '/parent/messages',
      ]) {
        await navigateInApp(page, path);
        await walk(page, [], seen);
      }
      // Setup and sign-up screens need only a family; B4 also asks for the PIN
      await walk(page, ['/sign-up', '/parent/forgot-pin', '/setup/pin', '/setup/child'], seen);
      await walk(page, ['/setup/books', '/setup/done'], seen);
      await page.goto('/setup/time-limit');
      await expect(page).toHaveURL(/\/parent\/pin\?next=%2Fsetup%2Ftime-limit$/);
      await enterPin(page);
      await expect(page).toHaveURL(/\/setup\/time-limit$/);
      await walk(page, [], seen);
      expect([...seen.keys()].sort()).toEqual(EXPECTED.map((e) => e.id).sort());
      for (const { id, shell } of EXPECTED) {
        const visit = seen.get(id);
        expect(visit?.shell, `${id} shell`).toBe(shell);
        const navigates = shell === 'A' || shell === 'B';
        expect(visit?.nav, `${id} navigation`).toBe(navigates && id !== 'C1' ? NAV[name] : 'none');
      }
    });
  });
}

test.describe('headers', () => {
  test.use({ viewport: WIDTHS.phone });
  test.beforeEach(async ({ page }) => {
    await signInFamily(page);
  });

  test('kid mode: Parent on a tab, Back inside it, Close in focus screens', async ({ page }) => {
    await page.getByRole('button', { name: 'Asha' }).click();
    await expect(page).toHaveURL(/\/kid\/learn$/);
    await page.getByRole('button', { name: 'Parent mode' }).click();
    await expect(page).toHaveURL(/\/parent\/pin$/);
    await page.goBack();

    await page.getByRole('button', { name: /English/ }).click();
    await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/kid\/learn$/);

    await page.getByRole('button', { name: /English/ }).click();
    await page.getByRole('button', { name: /Birds and nests/ }).click();
    await page.getByRole('button', { name: /Watch lesson/ }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL(/\/kid\/learn\/english\/t-sample\?type=topic$/);
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'kid');
  });

  test('parent mode: Back to kids, the bell, and focus moves to the new heading', async ({
    page,
  }) => {
    await unlockParent(page, '/parent/books');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'parent');
    await page.getByRole('button', { name: 'Messages' }).click();
    await expect(page).toHaveURL(/\/parent\/messages$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await page
      .getByRole('navigation', { name: 'Parent mode' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await page.getByRole('button', { name: 'Back to kids' }).click();
    await expect(page).toHaveURL(/\/who$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Who is learning?' })).toBeVisible();
  });

  test('the active tab follows sub-screens', async ({ page }) => {
    await unlockParent(page, '/parent/books/english/upload');
    const nav = page.getByRole('navigation', { name: 'Parent mode' });
    await expect(nav.getByRole('link', { name: 'Books' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
  });

  test('signed in, unknown paths and the root land on Who is learning?', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/who$/);
    await page.goto('/no/such/screen');
    await expect(page).toHaveURL(/\/who$/);
  });
});

test.describe('accessibility of each shell', () => {
  test.beforeEach(async ({ page }) => {
    await signInFamily(page);
  });
  for (const path of [
    '/who',
    '/kid/learn/english/1',
    '/kid/lesson/sample',
    '/kid/well-done',
    '/parent/progress',
  ]) {
    test(`${path} has no WCAG 2.1 AA violations at phone and tablet width`, async ({ page }) => {
      if (path.startsWith('/kid/')) {
        await page.getByRole('button', { name: 'Asha' }).click();
      } else if (path.startsWith('/parent/')) {
        await unlockParent(page, path);
      }
      for (const size of [WIDTHS.phone, WIDTHS.tablet]) {
        await page.setViewportSize(size);
        await navigateInApp(page, path);
        await page.evaluate(() => document.fonts.ready);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(
          results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
        ).toEqual([]);
      }
    });
  }
});
