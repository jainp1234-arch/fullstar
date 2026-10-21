import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { signInStudio } from './fakes';
import { navigateInApp } from './routes';

/** Plan 4.4: S11 manual check (trial) or agent check, accept-with-note, and S6 publish. */

async function openCheck(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
  await navigateInApp(page, '/studio/library/sample/edit');
  await page.getByRole('button', { name: 'Content check' }).click();
  await expect(page).toHaveURL(/\/studio\/content-check\?item=sample$/);
  await expect(page.getByText('This version has not been checked yet.')).toBeVisible();
}

async function tickAll(page: Page): Promise<void> {
  await expect(page.getByRole('checkbox')).toHaveCount(7);
  for (const box of await page.getByRole('checkbox').all()) {
    await box.check();
  }
}

test('a critical flag blocks publishing; a clean manual check publishes', async ({ page }) => {
  const server = await signInStudio(page);
  await openCheck(page);
  await expect(
    page.getByText('The content-check agent is switched off.', { exact: false }),
  ).toBeVisible();

  await tickAll(page);
  await page.getByRole('button', { name: 'Add flag' }).click();
  await page.getByLabel('Severity').selectOption('critical');
  await page.getByLabel('Category').selectOption('fact_mismatch');
  await page
    .getByLabel('Where (for example body.scenes[2].text or title)')
    .fill('body.scenes[0].text');
  await page.getByLabel('What is wrong').fill('Birds also use mud.');
  await page.getByRole('button', { name: 'Save manual check' }).click();
  await expect(page.getByText(/Check failed · 1 critical, 0 warnings/)).toBeVisible();
  await expect(page.locator('app-flag-item')).toContainText('Birds also use mud.');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Go to publish' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/sample\/publish$/);
  await page.getByRole('button', { name: 'Publish current version' }).click();
  await expect(page.getByText('Fix the critical flags before publishing.')).toBeVisible();
  expect(server.content.items[0].status).toBe('in_check');

  await page.getByRole('button', { name: 'Open content check' }).click();
  await tickAll(page);
  await page.getByRole('button', { name: 'Save manual check' }).click();
  await expect(page.getByText('Ready to publish.')).toBeVisible();
  await page.getByRole('button', { name: 'Go to publish' }).click();
  await page.getByRole('button', { name: 'Publish current version' }).click();
  await expect(page.getByText('Published. Children can see it now.')).toBeVisible();
  await expect(page.getByText('Published version: 2')).toBeVisible();
  expect(server.content.items[0].status).toBe('published');

  await page.getByRole('button', { name: 'Unpublish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByText('Unpublished.')).toBeVisible();
  expect(server.content.items[0].status).toBe('archived');
});

test('with the agent on, a warning is accepted with a note before publishing', async ({ page }) => {
  await signInStudio(page, { aiCheck: true });
  await openCheck(page);
  await expect(page.getByRole('button', { name: 'Save manual check' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run content check' }).click();
  await expect(page.getByText(/Check passed · 0 critical, 1 warning/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Not ready to publish yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Accept with note' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Accept' }).click();
  await expect(dialog.getByText('This is required.')).toBeVisible();
  await dialog.getByLabel('Note (why it is fine)').fill('Fine as a warm-up.');
  await dialog.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Accepted: Fine as a warm-up.', { exact: false })).toBeVisible();
  await expect(page.getByText('Ready to publish.')).toBeVisible();
});

test('without an item, the report lists the content waiting for a check', async ({ page }) => {
  const server = await signInStudio(page);
  server.content.items[0].status = 'in_check';
  await page
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Content check' })
    .click();
  await page.getByRole('button', { name: 'Check Birds and nests' }).click();
  await expect(page).toHaveURL(/\/studio\/content-check\?item=sample$/);
});
