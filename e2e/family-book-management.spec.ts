import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FakeChapter, FakeServer, signInFamily, unlockParent } from './fakes';
import { navigateInApp } from './routes';

/** Plan 7.4: P4 reorder and delete chapters, P9 Replace book with its warning. */

function chapter(id: string, number: number, title: string): FakeChapter {
  return { id, number, title, status: 'lessons_ready', page_count: 4, unclear_pages: 0 };
}

/** EVS uploaded chapter by chapter (numbers 1, 2, 4), shared by Asha and Ravi. */
function sharedBook(server: FakeServer, uploadMode = 'chapterwise'): void {
  server.family.books.push({
    id: 'book-evs',
    subject_id: 4,
    upload_mode: uploadMode,
    status: 'lessons_ready',
    class_level: 3,
    child_ids: ['child-asha', 'child-ravi'],
    chapters: [
      chapter('ch-plants', 1, 'Plants'),
      chapter('ch-water', 2, 'Water'),
      chapter('ch-food', 4, 'Food'),
    ],
    uploads: [],
  });
}

test('P4: chapters move up and down keeping their numbers, and one is deleted', async ({
  page,
}) => {
  const server = await signInFamily(page);
  sharedBook(server);
  await unlockParent(page, '/parent/books');
  const evs = page.getByRole('listitem').filter({ hasText: 'EVS' }).first();
  const lines = evs.locator('.chapter > span:first-child');
  await expect(lines).toHaveText(['Chapter 1: Plants', 'Chapter 2: Water', 'Chapter 4: Food']);
  await expect(evs.getByRole('button', { name: 'Move up: Plants' })).toHaveCount(0);
  await expect(evs.getByRole('button', { name: 'Move down: Food' })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await evs.getByRole('button', { name: 'Move down: Plants' }).click();
  await expect(page.getByText('Chapter order saved.')).toBeVisible();
  await expect(lines).toHaveText(['Chapter 1: Water', 'Chapter 2: Plants', 'Chapter 4: Food']);
  await evs.getByRole('button', { name: 'Move up: Food' }).click();
  await expect(lines).toHaveText(['Chapter 1: Water', 'Chapter 2: Food', 'Chapter 4: Plants']);

  await evs.getByRole('button', { name: 'Delete: Plants' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Delete Chapter 4: Plants?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep chapter' }).click();
  await expect(lines).toHaveCount(3);
  await evs.getByRole('button', { name: 'Delete: Plants' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete chapter' }).click();
  await expect(page.getByText('Chapter deleted.')).toBeVisible();
  await expect(lines).toHaveText(['Chapter 1: Water', 'Chapter 2: Food']);
  expect(server.family.books[0].chapters.map((c) => c.id)).toEqual(['ch-water', 'ch-food']);
});

test('P9: Replace book warns both children, removes the book and offers a new upload', async ({
  page,
}) => {
  const server = await signInFamily(page);
  sharedBook(server);
  await unlockParent(page, '/parent/books');
  await page.getByRole('button', { name: 'Replace book: EVS' }).click();
  await expect(page).toHaveURL(/\/parent\/books\/evs\/replace\?child=child-asha$/);
  await expect(
    page.getByRole('heading', { name: 'Remove the EVS book and its progress?' }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Asha and Ravi's progress on this book's chapters will be removed/),
  ).toBeVisible();
  await expect(page.getByText('This book has 3 chapters.', { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Remove the old book' }).click();
  await expect(page.getByText('The old book is removed. Upload the new one.')).toBeVisible();
  expect(server.family.replaced).toEqual(['book-evs']);
  expect(server.family.books).toHaveLength(0);

  await page.getByRole('button', { name: 'Upload chapter by chapter' }).click();
  await expect(page).toHaveURL(/\/parent\/books\/evs\/add-chapter\?child=child-asha$/);
  await navigateInApp(page, '/parent/books');
  await page.getByRole('tab', { name: 'Ravi' }).click();
  await expect(page).toHaveURL(/child=child-ravi/);
  const evs = page.getByRole('listitem').filter({ hasText: 'EVS' }).first();
  await expect(evs.locator('app-status-chip').getByText('No book')).toBeVisible();
  await expect(evs.getByRole('button', { name: 'Replace book: EVS' })).toHaveCount(0);
});

test('a whole book has no chapter moves; P9 without a book says so', async ({ page }) => {
  const server = await signInFamily(page);
  sharedBook(server, 'whole');
  await unlockParent(page, '/parent/books');
  const evs = page.getByRole('listitem').filter({ hasText: 'EVS' }).first();
  await expect(evs.getByRole('button', { name: /^Move|^Delete/ })).toHaveCount(0);
  await expect(evs.getByRole('button', { name: 'Replace book: EVS' })).toBeVisible();

  await unlockParent(page, '/parent/books/english/replace');
  await expect(page.getByText('This subject has no book yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to books' }).click();
  await expect(page).toHaveURL(/\/parent\/books\?child=child-asha$/);
});
