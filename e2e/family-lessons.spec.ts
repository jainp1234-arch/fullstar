import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FakeItem, FakeServer, signInFamily, unlockParent } from './fakes';

/** Plan 5.5: P19 messages lead to P8a, where a parent previews new lessons and answers. */

function prepared(server: FakeServer): void {
  server.family.books.push({
    id: 'book-evs',
    subject_id: 4,
    upload_mode: 'chapterwise',
    status: 'lessons_ready',
    class_level: 3,
    child_ids: ['child-asha'],
    chapters: [
      {
        id: 'ch-water',
        number: 2,
        title: 'Water',
        status: 'lessons_ready',
        page_count: 2,
        unclear_pages: 0,
        catalog_chapter_id: 'cc-water',
      },
    ],
    uploads: [],
  });
  const item = (id: string, kind: 'lesson' | 'question', title: string): FakeItem => ({
    id,
    kind,
    question_type: kind === 'question' ? 'true_false' : null,
    class_level: 3,
    subject: 'evs',
    topic_id: 't-water',
    difficulty: 1,
    lang: 'en',
    status: 'published',
    current_version_id: `${id}-v1`,
    published_version_id: `${id}-v1`,
    updated_at: '2026-10-22T09:00:00Z',
    catalog_chapter_id: 'cc-water',
    versions: [
      {
        id: `${id}-v1`,
        item_id: id,
        version_no: 1,
        title,
        body:
          kind === 'lesson'
            ? {
                scenes: [
                  {
                    id: 's1',
                    duration_ms: 6000,
                    text: 'Rain fills the pond.',
                    visual: { illustration: 'subject-evs', animation: 'fade-up' },
                  },
                ],
              }
            : { prompt: 'Fish live in water.' },
        solution: kind === 'question' ? { correct: true, explanation: 'Fish need water.' } : null,
        duration_seconds: 6,
        created_at: '2026-10-22T09:00:00Z',
        created_by_name: 'Meera',
      },
    ],
  });
  server.content.items.push(
    item('l-water', 'lesson', 'Water around us'),
    item('q-fish', 'question', 'Fish and water'),
  );
  server.family.messages.push(
    {
      id: 'm-old',
      kind: 'readalong_ready',
      title: 'Ready to read along',
      body: 'EVS Ch 2 is ready to read along.',
      link: { screen: 'P4', family_book_id: 'book-evs' },
      read_at: '2026-10-21T10:00:00Z',
      created_at: '2026-10-21T09:00:00Z',
    },
    {
      id: 'm-lessons',
      kind: 'lessons_ready',
      title: 'Lessons ready',
      body: 'Lessons for EVS Ch 2 are ready. We recommend a quick preview.',
      link: { screen: 'P8a', family_chapter_id: 'ch-water' },
      read_at: null,
      created_at: '2026-10-22T09:00:00Z',
    },
  );
}

test('a message leads to the preview, where the parent reports a problem', async ({ page }) => {
  const server = await signInFamily(page);
  prepared(server);
  await unlockParent(page, '/parent/messages');
  const items = page.locator('app-messages-page').getByRole('listitem');
  await expect(items.first()).toContainText('Lessons ready');
  await expect(items.first()).toContainText('New');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Open: Lessons ready' }).click();
  await expect(page).toHaveURL(/\/parent\/books\/evs\/preview\?child=child-asha&chapter=ch-water$/);
  expect(server.family.messages.find((m) => m.id === 'm-lessons')?.read_at).not.toBeNull();
  await expect(page.getByText('New · preview recommended')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Preview Water around us' }).click();
  await expect(page.getByRole('heading', { name: 'Water around us' })).toBeVisible();
  await expect(page.getByText('1 question')).toBeVisible();
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByRole('combobox', { name: 'Reason' }).selectOption('spelling');
  await page.getByLabel('What did you notice? (optional)').fill('A typo on scene 1');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Thank you. Our team will look at it.')).toBeVisible();
  expect(server.family.reports).toEqual([
    { content_item_id: 'l-water', reason: 'spelling', note: 'A typo on scene 1' },
  ]);
  await expect(page.getByText('Reported')).toBeVisible();
});

test('P4 offers the preview for a chapter with lessons, and Looks good is recorded', async ({
  page,
}) => {
  const server = await signInFamily(page);
  prepared(server);
  await unlockParent(page, '/parent/books');
  const evs = page.getByRole('listitem').filter({ hasText: 'EVS' }).first();
  await evs.getByRole('button', { name: 'Preview lessons' }).click();
  await page.getByRole('button', { name: 'Preview Water around us' }).click();
  await page.getByRole('button', { name: 'Looks good' }).click();
  await expect(page.getByText('Thank you for checking.')).toBeVisible();
  expect(server.family.previews['l-water']).toBe('looks_good');
  expect(server.family.reports).toHaveLength(0);
});

test('no messages: all caught up', async ({ page }) => {
  await signInFamily(page);
  await unlockParent(page, '/parent/messages');
  await expect(page.getByText("You're all caught up.")).toBeVisible();
});
