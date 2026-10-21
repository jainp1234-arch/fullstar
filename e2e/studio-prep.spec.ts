import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { FakeItem, FakeServer, signInStudio } from './fakes';

/** Plan 5.5: S8 queue and claim, S9 pages, prepared books, linking, drafting and Mark ready. */

const LESSON_BODY = {
  scenes: [
    {
      id: 's1',
      duration_ms: 6000,
      text: 'Water is everywhere.',
      visual: { illustration: 'subject-evs', animation: 'fade-up' },
    },
  ],
};
const MCQ_BODY = {
  prompt: 'Which one do we drink?',
  image_key: null,
  options: [
    { id: 'a', text: 'Water' },
    { id: 'b', text: 'Sand' },
  ],
};

/** Published content of a prepared chapter, as S5 → S11 → S6 leave it. */
function publish(
  server: FakeServer,
  catalogChapterId: string,
  kind: 'lesson' | 'question',
  n: number,
) {
  const id = `pub-${kind}-${n}`;
  const item: FakeItem = {
    id,
    kind,
    question_type: kind === 'question' ? 'mcq' : null,
    class_level: 3,
    subject: 'evs',
    topic_id: 't-water',
    difficulty: 2,
    lang: 'en',
    status: 'published',
    current_version_id: `${id}-v1`,
    published_version_id: `${id}-v1`,
    updated_at: '2026-10-22T09:00:00Z',
    catalog_chapter_id: catalogChapterId,
    versions: [
      {
        id: `${id}-v1`,
        item_id: id,
        version_no: 1,
        title: kind === 'lesson' ? 'Water around us' : `Question ${n}`,
        body: kind === 'lesson' ? LESSON_BODY : MCQ_BODY,
        solution: kind === 'question' ? { correct: ['a'], explanation: 'We drink water.' } : null,
        duration_seconds: 6,
        created_at: '2026-10-22T09:00:00Z',
        created_by_name: 'Meera',
      },
    ],
  };
  server.content.items.push(item);
}

async function openQueue(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Uploads queue' })
    .click();
  await expect(
    page.getByText('Chapters families uploaded, oldest first.', { exact: false }),
  ).toBeVisible();
}

test('an admin claims an upload, creates and links a prepared chapter, and marks it ready', async ({
  page,
}) => {
  const server = await signInStudio(page);
  await openQueue(page);
  await expect(page.getByText('Class 3 EVS · Ch 2: Water')).toBeVisible();
  await expect(page.getByText(/Family 3fa85f64 · 2 pages · Waiting 3 h/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const row = page.getByRole('listitem').filter({ hasText: 'Ch 2: Water' });
  await row.getByRole('button', { name: 'Claim' }).click();
  await expect(page).toHaveURL(/\/uploads\/sample\/prepare$/);
  await expect(page.getByText('Water is everywhere around us.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // No prepared book yet: create one; the chapter form starts with this chapter's number and name
  await page.getByLabel('Find a prepared book').fill('my evs');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No prepared book found. Create one.')).toBeVisible();
  await page.getByLabel('Book title').fill('My EVS Book');
  await page.getByRole('button', { name: 'Create book' }).click();
  await expect(page.getByLabel('Chapter name')).toHaveValue('Water');
  await page.getByRole('button', { name: 'Add chapter' }).click();
  await page.getByRole('button', { name: 'Link Water' }).click();
  await expect(page.getByText('Linked to Water.')).toBeVisible();
  await expect(
    page.getByText('0 published lessons, 0 published questions, 0 in draft or check'),
  ).toBeVisible();

  // Drafting opens S4 for this chapter
  await page.getByRole('button', { name: 'Draft lesson with Claude' }).click();
  await expect(page).toHaveURL(
    /library\/draft\?type=lesson&class=3&subject=evs&family_chapter=fc-sample/,
  );
  await expect(page.getByText('Drafting for an uploaded chapter', { exact: false })).toBeVisible();
  await page.goBack();

  // Not ready yet, then ready once a lesson and 20 questions are published
  await page.getByRole('button', { name: 'Mark chapter ready' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const linked = server.prep.tasks[0].catalog_chapter_id ?? '';
  publish(server, linked, 'lesson', 1);
  for (let n = 1; n <= 20; n++) {
    publish(server, linked, 'question', n);
  }
  // Back through the queue (the Studio session lives in memory, so no reload)
  await openQueue(page);
  await page.getByRole('tab', { name: 'Being prepared' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Ch 2: Water' })
    .getByRole('button', { name: 'Prepare' })
    .click();
  await expect(
    page.getByText('1 published lesson, 20 published questions', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mark chapter ready' }).click();
  await expect(page.getByText('Chapter ready. Every linked family has been told.')).toBeVisible();
  expect(server.prep.tasks[0].status).toBe('done');
});

test('linking to a ready prepared chapter gives the family its lessons at once', async ({
  page,
}) => {
  const server = await signInStudio(page);
  await openQueue(page);
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Plants around us' })
    .getByRole('button', { name: 'Prepare' })
    .click();
  await expect(
    page.getByText('Claim this chapter in the queue before preparing it.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: 'Link Plants around us' }).click();
  await expect(
    page.getByText('This chapter was ready: the family has its lessons now.'),
  ).toBeVisible();
  expect(server.prep.tasks[1].status).toBe('done');
});

test('a chapter another admin claimed is not claimed again', async ({ page }) => {
  const server = await signInStudio(page);
  Object.assign(server.prep.tasks[0], { status: 'in_progress', assigned: true, mine: false });
  server.prep.tasks.push({ ...server.prep.tasks[1], id: 'third', chapter_title: 'Air' });
  await page
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Uploads queue' })
    .click();
  await page.getByRole('tab', { name: 'Being prepared' }).click();
  await expect(page.getByText(/Another admin/)).toBeVisible();
  await page.getByRole('tab', { name: 'Waiting' }).click();
  server.prep.tasks[2].status = 'in_progress';
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Air' })
    .getByRole('button', { name: 'Claim' })
    .click();
  await expect(page.getByText('Another admin is preparing this chapter.')).toBeVisible();
});
