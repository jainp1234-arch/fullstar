import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { signInStudio } from './fakes';

/** Plan 4.3: S4 Draft with AI. Trial: copy the prompt, paste the reply; with AI on, Claude drafts. */

const PASTED_LESSON = `Here is your lesson:
\`\`\`json
{ "title": "Rain", "difficulty": 1, "body": { "scenes": [
  { "id": "s1", "duration_ms": 5000, "text": "Rain falls from clouds.", "visual": null } ] } }
\`\`\``;

async function openDraft(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Library' })
    .click();
  await page.getByRole('combobox', { name: 'Subject' }).selectOption('evs');
  await page.getByRole('button', { name: /^Water/ }).click();
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/draft\?class=3&subject=evs&topic=t1$/);
  await expect(page.getByRole('combobox', { name: 'Topic' })).toHaveValue('t1');
}

test('in trial the admin copies the prompt, pastes the reply and opens it in the editor', async ({
  page,
}) => {
  await signInStudio(page);
  await openDraft(page);
  await expect(page.getByText('AI drafts are switched off.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draft with AI', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Copy prompt for a Claude chat' }).click();
  await expect(page.getByLabel('Prompt', { exact: true })).toHaveValue(
    /Write a lesson for Class 3/,
  );

  await page.getByLabel('Paste the reply from Claude').fill('not json at all');
  await page.getByRole('button', { name: 'Check pasted draft' }).click();
  await expect(page.getByText('Please check this.')).toBeVisible();

  await page.getByLabel('Paste the reply from Claude').fill(PASTED_LESSON);
  await page.getByRole('button', { name: 'Check pasted draft' }).click();
  await expect(page.getByText('Ready to save')).toBeVisible();
  await expect(
    page.locator('app-content-preview').getByText('Rain falls from clouds.'),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Open Rain in the editor' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/new\/edit\?kind=lesson/);
  await expect(page.getByLabel('Title')).toHaveValue('Rain');
  await expect(page.getByLabel('Narration (shown and read aloud)')).toHaveValue(
    'Rain falls from clouds.',
  );
  await page.getByRole('button', { name: 'Save first version' }).click();
  await expect(page.getByText('Saved as version 1.')).toBeVisible();
});

test('a pasted question bank shows each problem and saves the ready questions', async ({
  page,
}) => {
  const server = await signInStudio(page);
  await openDraft(page);
  await page.getByRole('combobox', { name: 'Content type' }).selectOption('question_bank');
  const bank = {
    questions: [
      {
        title: 'Fish',
        question_type: 'true_false',
        difficulty: 1,
        body: { prompt: 'Fish live in water.' },
        solution: { correct: true, explanation: 'Fish breathe in water.' },
      },
      { question_type: 'mcq', body: { prompt: 'No title' } },
    ],
  };
  await page.getByLabel('Paste the reply from Claude').fill(JSON.stringify(bank));
  await page.getByRole('button', { name: 'Check pasted draft' }).click();
  await expect(page.getByText('1 problem to fix')).toBeVisible();
  await expect(page.getByText('title: This is required.')).toBeVisible();
  await page.getByRole('button', { name: 'Save 1 ready question as drafts' }).click();
  await expect(page.getByText('Saved 1 question as drafts.')).toBeVisible();
  await expect(page).toHaveURL(/\/studio\/library\?class=3&subject=evs&topic=t1/);
  expect(server.content.items.filter((item) => item.kind === 'question')).toHaveLength(1);
});

test('with AI drafts on, Claude drafts the lesson', async ({ page }) => {
  await signInStudio(page, { aiDrafts: true });
  await openDraft(page);
  await page.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clouds' })).toBeVisible();
  await expect(page.getByText('Clouds are tiny drops of water.')).toBeVisible();
});
