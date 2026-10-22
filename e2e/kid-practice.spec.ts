import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { FakeServer, signInFamily } from './fakes';

/** Plan 7.1: K8 tiles, K9 sets with instant feedback, K10 tables and the challenge, K11 mistakes. */

async function practice(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Asha' }).click();
  await page
    .getByRole('navigation', { name: /Kid/ })
    .getByRole('link', { name: 'Practice' })
    .click();
  await expect(page.getByRole('button', { name: /English grammar/ })).toBeVisible();
}

function answers(server: FakeServer) {
  return server.family.syncs.flatMap((s) => (s.body['answers'] ?? []) as Record<string, unknown>[]);
}

test('a practice set gives instant feedback and records the first answers', async ({ page }) => {
  const server = await signInFamily(page);
  await practice(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Nothing to practise in Hindi yet: the tile says so
  await page.getByRole('button', { name: /Hindi grammar/ }).click();
  await expect(page.getByText('No practice here yet. Check back soon!')).toBeVisible();

  await page.getByRole('button', { name: /English grammar/ }).click();
  await expect(page).toHaveURL(/\/kid\/practice\/set\/english$/);
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 2' })).toBeVisible();
  await page.getByRole('button', { name: /run/ }).click();
  await expect(page.getByText("Let's try again.")).toBeVisible();
  await page.getByRole('button', { name: /bird/ }).click();
  await expect(page.getByText('bird is right.', { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: /jump/ }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Well done! You got 1 star.' })).toBeVisible();

  await expect.poll(() => answers(server).length).toBe(2);
  expect(answers(server).map((a) => [a['question_item_id'], a['is_correct']])).toEqual([
    ['p-noun', false],
    ['p-verb', true],
  ]);
  // The finished attempt can come in a later sync than the answers
  const completed = () =>
    server.family.syncs
      .flatMap((s) => (s.body['attempts'] ?? []) as Record<string, unknown>[])
      .find((a) => a['completed_at']);
  await expect.poll(() => completed() !== undefined).toBe(true);
  expect(completed()).toMatchObject({
    kind: 'practice',
    subject_id: 1,
    correct_count: 1,
    total_count: 2,
  });
});

test('fix my mistakes brings back wrong answers, and says so when there are none', async ({
  page,
}) => {
  const server = await signInFamily(page);
  await practice(page);
  await page.getByRole('button', { name: /Fix my mistakes/ }).click();
  await expect(page.getByText('No mistakes to fix. Great job!')).toBeVisible();

  server.family.mistakes.push('p-verb');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: /Fix my mistakes · 1 to fix/ })).toBeVisible();
  await page.getByRole('button', { name: /Fix my mistakes/ }).click();
  await expect(page.getByText('Which word is a verb?')).toBeVisible();
  await page.getByRole('button', { name: /jump/ }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Well done! You got 3 stars.' })).toBeVisible();
});

test('tables: practise a table, then the 60-second challenge counts the right answers', async ({
  page,
}) => {
  const server = await signInFamily(page);
  await page.clock.install();
  await practice(page);
  await page.getByRole('button', { name: /Maths tables/ }).click();
  await page.getByRole('button', { name: '7 times table', exact: true }).click();
  await page.getByRole('button', { name: 'Practise' }).click();
  for (let i = 0; i < 10; i++) {
    await expect(page.getByRole('progressbar', { name: `Question ${i + 1} of 10` })).toBeVisible();
    const prompt =
      (await page
        .locator('app-question-card')
        .getByText(/7 × \d+ = \?/)
        .textContent()) ?? '';
    const by = Number(/7 × (\d+)/.exec(prompt)?.[1]);
    await page.getByRole('button', { name: new RegExp(`^[A-D]\\s?${7 * by}$`) }).click();
    await page.getByRole('button', { name: i === 9 ? 'Finish' : 'Next' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Well done! You got 3 stars.' })).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: '3 times table', exact: true }).click();
  await page.getByRole('button', { name: '60-second challenge' }).click();
  for (let i = 0; i < 3; i++) {
    const prompt =
      (await page
        .locator('app-question-card')
        .getByText(/3 × \d+ = \?/)
        .textContent()) ?? '';
    const by = Number(/3 × (\d+)/.exec(prompt)?.[1]);
    await page.getByRole('button', { name: new RegExp(`^[A-D]\\s?${3 * by}$`) }).click();
    await expect(page.getByText(`${i + 1} right!`)).toBeVisible();
  }
  await expect(page.getByText('3 right!')).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(page.getByRole('heading', { name: /Well done!/ })).toBeVisible();
  await expect
    .poll(() =>
      server.family.syncs
        .flatMap((s) => (s.body['attempts'] ?? []) as Record<string, unknown>[])
        .filter((a) => a['completed_at'])
        .map((a) => [a['kind'], a['correct_count'], a['total_count']]),
    )
    .toEqual([
      ['tables', 10, 10],
      ['tables_challenge', 3, 3],
    ]);
});
