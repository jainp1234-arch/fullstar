import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateInApp } from './routes';
import { signInStudio } from './fakes';

/** Plan 7.3: S7 Problem reports and S12 Support inbox; family side in family-support.spec.ts. */

test('S7: staff open a reported item, then mark the report fixed', async ({ page }) => {
  const server = await signInStudio(page);
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
  await navigateInApp(page, '/studio/reports');
  await expect(page.getByText('Lesson · Birds and nests (version 1)')).toBeVisible();
  await expect(page.getByText(/A wrong answer\s*· “The answer should be 12\.”/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Open item: Birds and nests' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/sample\/edit$/);
  await page.goBack();

  await page.getByRole('button', { name: 'Mark fixed: Birds and nests' }).click();
  await expect(page.getByText('Marked fixed. The family has been told.')).toBeVisible();
  await expect(page.getByText('No reports here.')).toBeVisible();
  expect(server.support.reports[0]).toMatchObject({ status: 'fixed' });

  await page.getByRole('tab', { name: 'Fixed' }).click();
  await expect(page.getByText('Lesson · Birds and nests (version 1)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark fixed: Birds and nests' })).toHaveCount(0);
});

test('S12: staff reply to a ticket and the family gets a message', async ({ page }) => {
  const server = await signInStudio(page);
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
  await navigateInApp(page, '/studio/support');
  await page.getByRole('button', { name: /Lessons will not load/ }).click();
  await expect(page.getByText('The English lessons show a spinner.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('textbox', { name: 'Reply' }).fill('Please update the app and try again.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('Reply sent. The family sees it in their messages.')).toBeVisible();
  await expect(page.getByText('Please update the app and try again.')).toBeVisible();
  expect(server.support.tickets[0].status).toBe('answered');
  expect(server.family.messages.at(-1)).toMatchObject({
    kind: 'support_reply',
    link: { screen: 'P16', ticket_id: 'tk1' },
  });

  await page.getByRole('button', { name: 'Back to the inbox' }).click();
  await expect(page.getByRole('button', { name: /Lessons will not load.*Answered/ })).toBeVisible();
});
