import { expect, test } from '@playwright/test';
import { FAKE_PIN, installFakes } from './fakes';
import { focusedName, press, recordSteps, steps, tabTo } from './keyboard';
import { onScreen } from './routes';

/**
 * Plan 9.4: the family app by keyboard only (Tab, Shift+Tab, Enter, Space, digits; no clicks).
 * Every focused control must show a visible focus ring; the steps are recorded for the PR.
 */
// eslint-disable-next-line no-empty-pattern -- Playwright needs the fixtures argument
test.afterEach(async ({}, testInfo) => recordSteps(testInfo));

test('family app by keyboard: sign in, a lesson with its quiz, parent mode with the PIN', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installFakes(page);
  await page.goto('/welcome');
  await onScreen(page, 'A1');
  steps.push('Open /welcome (A1)');

  await tabTo(page, /^Sign in$/);
  await press(page, 'Enter', 'Who is learning? (C1)');
  await onScreen(page, 'C1');

  await tabTo(page, /^Asha/);
  await press(page, 'Enter', 'My subjects (K1)');
  await onScreen(page, 'K1');

  await tabTo(page, /English/);
  await press(page, 'Enter', 'English (K2)');
  await onScreen(page, 'K2');

  await tabTo(page, /Birds and nests/);
  await press(page, 'Enter', 'the topic (K3)');
  await onScreen(page, 'K3');

  await tabTo(page, /Watch lesson/);
  await press(page, 'Enter', 'the lesson player (K4)');
  await onScreen(page, 'K4');
  await expect(page.getByText('A bird builds a nest.')).toBeVisible();

  await tabTo(page, /^Next$/);
  await press(page, 'Enter', 'the quiz scene');
  await tabTo(page, /A nest/);
  await press(page, 'Space', 'answer chosen');
  await expect(page.getByText('Birds build nests for their eggs.', { exact: false })).toBeVisible();

  // Back to the kid home, then parent mode behind the PIN
  await page.keyboard.press('Escape');
  await page.goBack();
  await page.goBack();
  await page.goBack();
  await onScreen(page, 'K1');
  steps.push('Browser Back ×3 → My subjects (K1)');
  await tabTo(page, /Parent mode/);
  await press(page, 'Enter', 'parent PIN (P0)');
  await onScreen(page, 'P0');
  // Digits are typed while focus is in the PIN pad
  await tabTo(page, /^1$/);
  for (const digit of FAKE_PIN) {
    await page.keyboard.press(digit);
  }
  steps.push(`Type ${FAKE_PIN.length} digits → Progress (P1)`);
  await onScreen(page, 'P1');

  await tabTo(page, /^Books$/);
  await press(page, 'Enter', 'Books (P4)');
  await onScreen(page, 'P4');
  // Shift+Tab goes back through the same controls
  await page.keyboard.press('Shift+Tab');
  expect(await focusedName(page)).not.toBe('');
  steps.push(`Shift+Tab → "${await focusedName(page)}"`);
});
