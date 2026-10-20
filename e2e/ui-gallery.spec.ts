import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Plan 2.2: every component state is in the gallery and axe finds no WCAG 2.1 AA violations. */
const MODES = ['kid', 'parent', 'studio'] as const;

test.use({ viewport: { width: 390, height: 844 } });

for (const mode of MODES) {
  test(`UI gallery has no accessibility violations in ${mode} mode`, async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
    await page.evaluate(() => document.fonts.ready);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
    expect(summary).toEqual([]);
  });
}

test('the gallery shows every 2.2a component', async ({ page }) => {
  await page.goto('/dev/ui');
  for (const selector of [
    'app-button',
    'app-icon-button',
    'app-star-pill',
    'app-list-card',
    'app-corner-tab',
    'app-tile',
    'app-banner-card',
    'app-progress-card',
    'app-progress-bar',
    'app-notice-card',
    'app-action-card',
    'app-section-header',
  ]) {
    await expect(page.locator(selector).first(), selector).toBeVisible();
  }
});
