import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInFamily, unlockParent } from './fakes';

/** Plan 6.4: P1 This week per child, P2 subject detail, and the kid-mode time indicator. */

test('P1 shows the chosen child week and P2 the subject detail', async ({ page }) => {
  await signInFamily(page);
  await unlockParent(page, '/parent/progress');
  await expect(page.getByText('95 minutes learning on 4 days')).toBeVisible();
  await expect(page.getByText('2 chapters done')).toBeVisible();
  await expect(page.getByText('Saving water · EVS')).toBeVisible();
  await expect(page.getByRole('button', { name: /EVS/ })).toContainText(
    '2 of 5 chapters done · 2 lessons this week',
  );
  await expect(page.getByText('Reading results will appear after the first test.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: /EVS/ }).click();
  await expect(page).toHaveURL(/\/parent\/progress\/subject\/evs\?child=child-asha$/);
  await expect(page.getByText('Chapter 1: Plants')).toBeVisible();
  await expect(page.getByText('70% right first time (7 of 10)')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The other child has not started: the getting-started checklist
  await page.goBack();
  await page.getByRole('tab', { name: 'Ravi' }).click();
  await expect(page.getByText('Getting started')).toBeVisible();
  await expect(page.getByText('0 minutes learning on 0 days')).toBeVisible();
});

test('kid mode shows the time indicator against the daily limit', async ({ page }) => {
  await signInFamily(page);
  await page.getByRole('button', { name: 'Asha' }).click();
  const bar = page.getByRole('progressbar', { name: /Time today/ });
  await expect(bar).toHaveAttribute('aria-label', 'Time today: 5 of 30 minutes');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
