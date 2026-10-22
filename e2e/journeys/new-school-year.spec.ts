import { expect, test } from '@playwright/test';
import { navigateInApp } from '../routes';
import { finishSetup, newEmail, parentMode, signUp, skipWithoutStack } from './stack';

/**
 * App Flow §8 "New school year" on the full stack: Settings → the child (P15) → Move to next class,
 * the warning that Class 3 progress is erased, confirm; the child's subjects are now Class 4.
 */
skipWithoutStack();

test('New school year: move to Class 4 after the warning; subjects reset', async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, newEmail('school-year'));
  await finishSetup(page, { name: 'Dev', age: '9', picture: 'Lion' });
  await parentMode(page);
  await navigateInApp(page, '/parent/settings');
  await page.getByRole('button', { name: /Dev.*Class 3/ }).click();
  await expect(page).toHaveURL(/\/parent\/settings\/children\/[^/]+$/);

  await page.getByRole('button', { name: 'Move to Class 4' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Erase Class 3 progress?' })).toBeVisible();
  await expect(
    dialog.getByText('This will erase all progress for Class 3. Continue?'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Erase progress' }).click();
  await expect(page.getByText('Dev is now in Class 4.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Class 4' })).toBeVisible();

  // The child's subjects are Class 4 now
  await navigateInApp(page, '/who');
  await page.getByRole('button', { name: 'Dev' }).click();
  await expect(page.getByText('Class 4 practice').first()).toBeVisible();
});
