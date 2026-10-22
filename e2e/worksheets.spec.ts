import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateInApp } from './routes';
import { signInFamily, unlockParent } from './fakes';

/** Plan 7.2: P10 list, P11 create with preview and shuffle, P12 print (rendering → ready), P13, K6. */

test('a parent creates a worksheet, shuffles it, prints it and ticks weak spots', async ({
  page,
}) => {
  const server = await signInFamily(page);
  await unlockParent(page, '/parent/worksheets');
  await expect(page.getByText('No worksheets yet.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Create your first worksheet' }).click();
  await expect(page).toHaveURL(/\/parent\/worksheets\/new$/);
  await page.getByRole('combobox', { name: 'Number of questions' }).selectOption('5');
  await expect(page.getByRole('combobox', { name: 'Topic' })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Create worksheet' }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  const first = page.locator('ol li').first();
  await expect(first).toHaveText('Worksheet question 1');
  await page.getByRole('button', { name: 'Shuffle again' }).click();
  await expect(first).toHaveText('Worksheet question 5');
  expect(server.family.worksheets[0]).toMatchObject({ source: 'topic', question_count: 5 });

  await page.getByRole('button', { name: 'Print / share' }).click();
  await expect(page).toHaveURL(/\/parent\/worksheets\/ws-1\/print$/);
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible({ timeout: 10_000 });
  expect(server.family.worksheets[0].pdf_requests).toBe(2);
  expect(server.family.worksheets[0].printed_at).not.toBeNull();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await navigateInApp(page, '/parent/worksheets/ws-1/solutions');
  await expect(page.getByText('Right 5')).toBeVisible();
  await expect(page.getByText('Because 5.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Air around us' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(server.family.worksheets[0].weak_spots).toEqual(['t-air']);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await navigateInApp(page, '/parent/worksheets');
  await expect(page.getByRole('button', { name: 'Print / share: Birds and nests' })).toBeVisible();
});

test('the child does a worksheet on screen from K3', async ({ page }) => {
  const server = await signInFamily(page);
  server.family.worksheets.push({
    id: 'ws-kid',
    child_id: 'child-asha',
    subject_id: 1,
    subject: 'english',
    subject_name: 'English',
    source: 'topic',
    family_chapter_id: null,
    topic_id: 't-sample',
    source_title: 'Birds and nests',
    chapter_number: null,
    question_count: 2,
    status: 'ready',
    printed_at: null,
    created_at: '2026-10-22T08:00:00Z',
    order: ['wq-1', 'wq-2'],
    weak_spots: [],
    pdf_requests: 0,
  });
  await page.getByRole('button', { name: 'Asha' }).click();
  await page.getByRole('button', { name: /English/ }).click();
  await page.getByRole('button', { name: /Birds and nests/ }).click();
  await page.getByRole('button', { name: /Worksheet/ }).click();
  await expect(page).toHaveURL(/\/kid\/worksheet\/ws-kid\?back=/);
  await page.getByRole('button', { name: /Right 1/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /Wrong 2/ }).click();
  await page.getByRole('button', { name: /Right 2/ }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Well done! You got 1 star.' })).toBeVisible();
  expect(server.family.worksheets[0].printed_at).not.toBeNull();
  await expect
    .poll(() =>
      server.family.syncs
        .flatMap((s) => (s.body['attempts'] ?? []) as Record<string, unknown>[])
        .some((a) => a['kind'] === 'worksheet' && a['completed_at'] && a['correct_count'] === 1),
    )
    .toBe(true);
});
