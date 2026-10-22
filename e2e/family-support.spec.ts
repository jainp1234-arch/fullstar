import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateInApp } from './routes';
import { signInFamily, unlockParent } from './fakes';

/** Plan 7.3: P18 Report a problem and P16 Contact us, with a reply via P19; Studio side in studio-support.spec.ts. */

test('P18: a parent reports a worksheet question and comes back to the solutions', async ({
  page,
}) => {
  const server = await signInFamily(page);
  await unlockParent(page, '/parent/worksheets');
  await page.getByRole('button', { name: 'Create your first worksheet' }).click();
  await page.getByRole('combobox', { name: 'Number of questions' }).selectOption('5');
  await expect(page.getByRole('combobox', { name: 'Topic' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create worksheet' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();

  await navigateInApp(page, '/parent/worksheets/ws-1/solutions');
  await page.getByRole('button', { name: 'Report a problem: Worksheet question 1' }).click();
  await expect(page).toHaveURL(/\/parent\/report\?item=wq-1&back=/);
  await page.getByRole('combobox', { name: 'Reason' }).selectOption('spelling');
  await page.getByLabel('What did you notice? (optional)').fill('“nests” is misspelt');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Thank you. We will let you know when it is fixed.')).toBeVisible();
  expect(server.support.reports.at(-1)).toMatchObject({
    content_item_id: 'wq-1',
    reason: 'spelling',
    note: '“nests” is misspelt',
    status: 'open',
  });

  await page.getByRole('button', { name: 'Back' }).last().click();
  await expect(page).toHaveURL(/\/parent\/worksheets\/ws-1\/solutions$/);
});

test('P18 without an item says where to open it', async ({ page }) => {
  await signInFamily(page);
  await unlockParent(page, '/parent/report');
  await expect(
    page.getByText('Open Report a problem from a lesson or a worksheet question.'),
  ).toBeVisible();
});

test('P16: a parent sends a Contact us message and a reply from our team opens it', async ({
  page,
}) => {
  const server = await signInFamily(page);
  await unlockParent(page, '/parent/settings/help');
  await page.getByText('How many children can I add?').click();
  await expect(page.getByText(/Up to 2\./)).toBeVisible();

  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('This is required.').first()).toBeVisible();
  expect(server.support.tickets.filter((t) => t.family_ref === 'F-you')).toHaveLength(0);

  await page.getByLabel('Subject').fill('Worksheet printing');
  await page.getByRole('textbox', { name: 'Message' }).fill('The PDF prints very small.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Thank you. We will reply in your messages.')).toBeVisible();
  await expect(page.getByText('Your messages to us')).toBeVisible();
  await expect(page.getByText('Waiting for our team')).toBeVisible();
  const ticket = server.support.tickets.find((t) => t.subject === 'Worksheet printing');
  expect(ticket?.messages).toMatchObject([
    { author: 'parent', body: 'The PDF prints very small.' },
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Our team replies in S12; the reply arrives as a P19 message that opens P16
  ticket!.messages.push({
    id: 'staff-1',
    author: 'staff',
    body: 'Choose "Fit to page" when printing.',
    created_at: new Date().toISOString(),
  });
  ticket!.status = 'answered';
  server.family.messages.push({
    id: 'm-reply',
    kind: 'support_reply',
    title: 'Reply from our team',
    body: 'Choose "Fit to page" when printing.',
    link: { screen: 'P16', ticket_id: ticket!.id },
    read_at: null,
    created_at: new Date().toISOString(),
  });
  await navigateInApp(page, '/parent/messages');
  await page.getByRole('button', { name: 'Open: Reply from our team' }).click();
  await expect(page).toHaveURL(/\/parent\/settings\/help$/);
  await expect(page.getByText('Answered')).toBeVisible();
  await expect(page.getByText('Choose "Fit to page" when printing.')).toBeVisible();

  await page.getByRole('button', { name: 'Reply: Worksheet printing' }).click();
  await page.getByRole('textbox', { name: 'Reply' }).fill('That worked, thank you.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('That worked, thank you.')).toBeVisible();
  expect(ticket?.status).toBe('open');
});
