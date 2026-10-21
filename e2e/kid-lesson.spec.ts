import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { FakeServer, signInFamily } from './fakes';

/** Plan 6.2: K4 lesson with an inline quiz, K7 well done, offline events synced once. */

async function openLesson(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Asha' }).click();
  await page.getByRole('button', { name: /English/ }).click();
  await page.getByRole('button', { name: /Birds and nests/ }).click();
  await page.getByRole('button', { name: /Watch lesson/ }).click();
  await expect(page.getByText('A bird builds a nest.')).toBeVisible();
}

function completed(server: FakeServer) {
  return server.family.syncs.flatMap((s) =>
    ((s.body['attempts'] ?? []) as Record<string, unknown>[]).filter((a) => a['completed_at']),
  );
}

test('a lesson plays scene by scene, the quiz counts the first answer, and K7 shows the stars', async ({
  page,
}) => {
  const server = await signInFamily(page);
  await openLesson(page);
  await expect(page.getByRole('progressbar')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('What does a bird build?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.getByRole('button', { name: /A car/ }).click();
  await expect(page.getByText("Let's try again.")).toBeVisible();
  await page.getByRole('button', { name: /A nest/ }).click();
  await expect(page.getByText('Birds build nests for their eggs.', { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/\/kid\/well-done\?stars=1/);
  await expect(page.getByRole('heading', { name: 'Well done! You got 1 star.' })).toBeVisible();

  await expect.poll(() => completed(server).length).toBe(1);
  const attempt = completed(server)[0];
  expect(attempt).toMatchObject({
    kind: 'lesson',
    content_item_id: 'sample',
    correct_count: 0,
    total_count: 1,
  });
  const answers = server.family.syncs.flatMap(
    (s) => (s.body['answers'] ?? []) as Record<string, unknown>[],
  );
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({ question_item_id: 'q-nest', is_correct: false });

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/\/kid\/learn\/english\/t-sample\?type=topic$/);
});

test('a lesson finished offline syncs once when back online', async ({ page, context }) => {
  const server = await signInFamily(page);
  await openLesson(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /A nest/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Well done! You got 3 stars.' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(completed(server)).toHaveLength(0);

  await context.setOffline(false);
  await expect.poll(() => completed(server).length, { timeout: 10_000 }).toBe(1);
  expect(completed(server)[0]).toMatchObject({ correct_count: 1, total_count: 1 });
  // Nothing is sent twice: the completed attempt left the device's queue
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1000);
  expect(completed(server)).toHaveLength(1);
  expect(Object.values(server.family.attempts).reduce((sum, a) => sum + a.stars, 0)).toBe(3);
});
