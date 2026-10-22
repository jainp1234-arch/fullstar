import { Page, expect, test } from '@playwright/test';
import { installFakes, signInFamily, unlockParent } from './fakes';
import { navigateInApp } from './routes';
import { goOffline, goOnline } from './offline';

/** Plan 7.5: the App Flow §11 offline matrix, one test per row. */

async function openLesson(page: Page): Promise<void> {
  await page.getByRole('button', { name: /English/ }).click();
  await page.getByRole('button', { name: /Birds and nests/ }).click();
  await page.getByRole('button', { name: /Watch lesson/ }).click();
  await expect(page.getByText('A bird builds a nest.')).toBeVisible();
}

test('saved and already-downloaded lessons: yes', async ({ page, context }) => {
  await signInFamily(page);
  await page.getByRole('button', { name: 'Asha' }).click();
  await openLesson(page);
  await page.getByRole('button', { name: 'Close' }).click();
  await goOffline(page, context);
  await navigateInApp(page, '/kid/learn');
  await openLesson(page);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('What does a bird build?')).toBeVisible();
});

test('generated worksheets: yes, on screen and as saved PDFs', async ({ page, context }) => {
  const server = await signInFamily(page);
  await unlockParent(page, '/parent/worksheets');
  await page.getByRole('button', { name: 'Create your first worksheet' }).click();
  await page.getByRole('combobox', { name: 'Number of questions' }).selectOption('5');
  await expect(page.getByRole('combobox', { name: 'Topic' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create worksheet' }).click();
  await page.getByRole('button', { name: 'Print / share' }).click();
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible({ timeout: 10_000 });

  await goOffline(page, context);
  await navigateInApp(page, '/parent/worksheets');
  await navigateInApp(page, '/parent/worksheets/ws-1/print');
  await expect(page.getByText('Opened from this device.')).toBeVisible({ timeout: 10_000 });
  await goOnline(page, context);

  // On screen (K6): opened once online, then again offline
  expect(server.family.worksheets[0].child_id).toBe('child-asha');
  await navigateInApp(page, '/who');
  await page.getByRole('button', { name: 'Asha' }).click();
  await navigateInApp(page, '/kid/worksheet/ws-1');
  await expect(page.getByText('Worksheet question 1')).toBeVisible();
  await goOffline(page, context);
  await navigateInApp(page, '/kid/learn');
  await navigateInApp(page, '/kid/worksheet/ws-1');
  await expect(page.getByText('Worksheet question 1')).toBeVisible();
});

test('tables practice and the 60-second challenge: yes', async ({ page, context }) => {
  await signInFamily(page);
  await page.getByRole('button', { name: 'Asha' }).click();
  await navigateInApp(page, '/kid/practice');
  await expect(page.getByRole('button', { name: /Maths tables/ })).toBeVisible();
  await goOffline(page, context);
  await navigateInApp(page, '/kid/learn');
  await navigateInApp(page, '/kid/practice');
  // Tables are made on the device; the other practice needs the internet
  await expect(page.getByRole('button', { name: /Maths tables/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByRole('button', { name: /EVS quiz/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('button', { name: /Maths tables/ }).click();
  await page.getByRole('button', { name: '7 times table', exact: true }).click();
  await page.getByRole('button', { name: 'Practise' }).click();
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 10' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /Maths tables/ }).click();
  await page.getByRole('button', { name: '3 times table', exact: true }).click();
  await page.getByRole('button', { name: '60-second challenge' }).click();
  await expect(page.locator('app-question-card').getByText(/3 × \d+ = \?/)).toBeVisible();
});

test.fixme('reading test: no (K12–K14 arrive with Plan 8.3)', () => {
  // K12 will show "This needs the internet." offline
});

test('uploading books or chapters: no', async ({ page, context }) => {
  await signInFamily(page);
  await unlockParent(page, '/parent/books/maths/upload');
  await page
    .locator('app-upload-zone input[type="file"]')
    .last()
    .setInputFiles({
      name: 'maths.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 fake'),
    });
  await goOffline(page, context);
  await expect(page.getByText("You're offline. Some features are paused.").first()).toBeVisible();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "You're offline" })).toBeVisible();
});

test('progress dashboard: the last saved view', async ({ page, context }) => {
  await signInFamily(page);
  await unlockParent(page, '/parent/progress');
  await expect(page.getByText(/minutes? learning/).first()).toBeVisible();
  await goOffline(page, context);
  await navigateInApp(page, '/parent/books');
  await navigateInApp(page, '/parent/progress');
  await expect(
    page.getByText('Last saved view. It updates when you are back online.'),
  ).toBeVisible();
  await expect(page.getByText(/minutes? learning/).first()).toBeVisible();
});

test('sign-in, email code and PIN reset: no', async ({ page, context }) => {
  await installFakes(page);
  await page.goto('/welcome');
  await goOffline(page, context);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  // The banner and the Sign in message both say so
  await expect(page.getByRole('alert').filter({ hasText: "You're offline" })).toBeVisible();
  await goOnline(page, context);

  await signInFamily(page);
  // Past the fresh sign-in, so Forgot PIN asks for an email code
  await page.clock.install();
  await page.clock.fastForward('15:00');
  await page.getByRole('button', { name: 'Parent mode' }).click();
  await goOffline(page, context);
  await page.getByRole('link', { name: 'Forgot PIN?' }).click();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "You're offline" })).toBeVisible();
  await expect(page).toHaveURL(/\/parent\/forgot-pin$/);
});
