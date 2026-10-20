import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';

/** Plan 2.2: every component state is in the gallery and axe finds no WCAG 2.1 AA violations. */
const MODES = ['kid', 'parent', 'studio'] as const;

test.use({ viewport: { width: 390, height: 844 } });

async function axeViolations(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) {
    builder = builder.include(include);
  }
  const results = await builder.analyze();
  return results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

for (const mode of MODES) {
  test(`UI gallery has no accessibility violations in ${mode} mode`, async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
    await page.evaluate(() => document.fonts.ready);

    expect(await axeViolations(page)).toEqual([]);
  });
}

test('the gallery shows every 2.2a and 2.2b component', async ({ page }) => {
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
    'app-text-field',
    'app-code-input',
    'app-pin-pad',
    'app-upload-zone',
    'app-page-thumb',
    'app-status-chip',
    'app-empty-state',
    'app-skeleton',
    'app-message-item',
    'app-data-table',
  ]) {
    await expect(page.locator(selector).first(), selector).toBeVisible();
  }
});

test.describe('overlays', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'parent', exact: true }).click();
  });

  test('the dialog traps focus, passes axe and returns focus on close', async ({ page }) => {
    const opener = page.getByRole('button', { name: 'Open dialog' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Erase Class 3 progress?' });
    await expect(dialog).toBeVisible();
    expect(await axeViolations(page, '.cdk-overlay-container')).toEqual([]);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await dialog.getByRole('button', { name: 'Keep progress' }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.getByText('Keep progress', { exact: true })).toBeVisible();
  });

  test('the bottom sheet passes axe and closes with Escape', async ({ page }) => {
    const opener = page.getByRole('button', { name: 'Open sheet' });
    await opener.click();
    const sheet = page.getByRole('dialog', { name: 'Choose a subject' });
    await expect(sheet).toBeVisible();
    expect(await axeViolations(page, '.cdk-overlay-container')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('toasts are announced; errors stay until dismissed', async ({ page }) => {
    await page.getByRole('button', { name: 'Show error toast' }).click();
    const live = page.locator('.cdk-overlay-container [aria-live]');
    await expect(live.first()).toHaveAttribute('aria-live', 'assertive');
    const toast = page.locator('app-toast');
    await expect(toast).toContainText('Something went wrong');
    expect(await axeViolations(page, '.cdk-overlay-container')).toEqual([]);
    await page.waitForTimeout(4500);
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast).toBeHidden();
  });
});

test.describe('forms', () => {
  test('the code input accepts a pasted code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/dev/ui');
    await page.evaluate(() => navigator.clipboard.writeText('024183'));
    const first = page.getByRole('textbox', { name: 'Digit 1 of 6' }).first();
    await first.focus();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByText('Code entered: 024183')).toBeVisible();
  });

  test('the PIN pad works from the keyboard and shakes on a wrong PIN', async ({ page }) => {
    await page.goto('/dev/ui');
    const pad = page.locator('app-pin-pad');
    await pad.getByRole('button', { name: '1', exact: true }).focus();
    await page.keyboard.type('9999');
    await expect(pad.locator('.dots--shake')).toHaveCount(1);
    await expect(pad.locator('.dot--filled')).toHaveCount(0);
    await page.keyboard.type('1234');
    await expect(page.getByText('PIN accepted.')).toBeVisible();
  });
});
