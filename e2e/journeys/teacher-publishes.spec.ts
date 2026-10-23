import { Page, expect, test } from '@playwright/test';
import { signInStaff, skipWithoutStack } from './stack';

/**
 * App Flow §8 "Teacher publishes content" on the full stack: S1 sign in (real Keycloak code and
 * authenticator code) → S3 Class 3 → EVS → Water → S4 drafts a lesson with AI (Claude stand-in) →
 * S5 saves and previews → S11 content check (clean) → S6 publishes; then 10 questions drafted.
 */
skipWithoutStack();

/** S3 → Class 3 → EVS → Water → S4 for that topic. */
async function draftForWater(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Library' })
    .click();
  await page.getByRole('combobox', { name: 'Class' }).selectOption('3');
  await page.getByRole('combobox', { name: 'Subject' }).selectOption('evs');
  await page.getByRole('button', { name: /^Water/ }).click();
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/draft\?/);
}

test('Teacher publishes content: S3 → S4 AI drafts → S5 → S11 → S6', async ({ page }) => {
  test.setTimeout(240_000);
  await signInStaff(page);

  // The lesson: S4 → S5 (save and preview) → S11 → S6
  await draftForWater(page);
  await page.getByRole('combobox', { name: 'Content type' }).selectOption('lesson');
  await page.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await page
    .getByRole('button', { name: /^Open .* in the editor$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/studio\/library\/[^/]+\/edit/);
  await expect(page.getByRole('region', { name: 'Preview as a child sees it' })).toBeVisible();
  await page.getByRole('button', { name: 'Save first version' }).click();
  await expect(page.getByText('Saved as version 1.')).toBeVisible();
  await page.getByRole('button', { name: 'Content check' }).click();
  await page.getByRole('button', { name: 'Run content check' }).click();
  await expect(page.getByText(/Check passed · 0 critical, 0 warnings/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Ready to publish.')).toBeVisible();
  await page.getByRole('button', { name: 'Go to publish' }).click();
  await page.getByRole('button', { name: 'Publish current version' }).click();
  await expect(page.getByText('Published. Children can see it now.')).toBeVisible();
  await expect(page.getByText('Published version: 1')).toBeVisible();

  // Ten questions for the same topic, saved as drafts
  await draftForWater(page);
  await page.getByRole('combobox', { name: 'Content type' }).selectOption('question_bank');
  await page.getByRole('combobox', { name: 'Number of questions' }).selectOption('10');
  await page.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await page.getByRole('button', { name: 'Save 10 ready questions as drafts' }).click();
  await expect(page.getByText('Saved 10 questions as drafts.')).toBeVisible();
});
