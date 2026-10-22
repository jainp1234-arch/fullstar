import { Page, expect, test } from '@playwright/test';
import { signInStudio } from './fakes';
import { press, recordSteps, steps, tabTo } from './keyboard';
import { onScreen } from './routes';

/** Plan 9.4: Studio by keyboard only, with a visible focus ring on every focused control. */
// eslint-disable-next-line no-empty-pattern -- Playwright needs the fixtures argument
test.afterEach(async ({}, testInfo) => recordSteps(testInfo));

/** The focused native select changes with ArrowDown, as a keyboard user would. */
async function arrowTo(page: Page, box: string, label: string): Promise<void> {
  const select = page.getByRole('combobox', { name: box });
  await expect(select, `${box} has the focus`).toBeFocused();
  for (let i = 0; i < 8; i++) {
    const chosen = await select.evaluate(
      (el: HTMLSelectElement) => el.selectedOptions[0]?.textContent?.trim() ?? '',
    );
    if (chosen === label) {
      steps.push(`ArrowDown ×${i} → ${box}: ${label}`);
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`Could not reach ${label} in ${box} with ArrowDown`);
}

test('Studio by keyboard: library, choose a topic, back to the dashboard', async ({ page }) => {
  test.setTimeout(90_000);
  await signInStudio(page);
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
  steps.push('Signed in to Studio, dashboard (S2)');

  await tabTo(page, /^Library$/);
  await press(page, 'Enter', 'Library (S3)');
  await onScreen(page, 'S3');

  await tabTo(page, /^Class 1/);
  await arrowTo(page, 'Class', 'Class 3');
  await tabTo(page, /^English/);
  await arrowTo(page, 'Subject', 'EVS');
  await tabTo(page, /^Water/);
  await press(page, 'Enter', 'the Water topic is chosen');
  await expect(page.getByRole('button', { name: /^Water/ })).toHaveAttribute(
    'aria-current',
    'true',
  );

  await tabTo(page, /^Dashboard$/, 60);
  await press(page, 'Enter', 'Dashboard (S2)');
  await onScreen(page, 'S2');
});
