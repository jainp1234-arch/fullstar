import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInFamily } from './fakes';

/** Plan 6.1: K1 subjects (book or Class 3 practice), K2 chapters or topics, K3 cards. */

test('without a book a subject shows Class 3 practice topics and their lesson', async ({
  page,
}) => {
  await signInFamily(page);
  await page.getByRole('button', { name: 'Asha' }).click();
  await expect(page.getByRole('heading', { name: 'Hi Asha!' })).toBeVisible();
  await expect(page.getByText(/^Class \d practice$/)).toHaveCount(4);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: /English/ }).click();
  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
  await expect(page.getByRole('button', { name: /First steps/ })).toContainText('Done');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: /Birds and nests/ }).click();
  await expect(page).toHaveURL(/\/kid\/learn\/english\/t-sample\?type=topic$/);
  await expect(page.getByRole('button', { name: /Watch lesson/ })).toContainText('2 min');
  await expect(page.getByRole('button', { name: /Read along/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Worksheet/ }).click();
  await expect(page.getByText('Worksheets are coming soon.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('a ready chapter makes the subject My book; its lesson is Coming soon while read-along works', async ({
  page,
}) => {
  const server = await signInFamily(page);
  server.family.books.push({
    id: 'book-evs',
    subject_id: 4,
    upload_mode: 'chapterwise',
    status: 'readalong_ready',
    class_level: 3,
    child_ids: ['child-asha'],
    chapters: [
      {
        id: 'ch-wait',
        number: 1,
        title: 'Plants',
        status: 'processing',
        page_count: 3,
        unclear_pages: 0,
      },
      {
        id: 'ch-water',
        number: 2,
        title: 'Water',
        status: 'readalong_ready',
        page_count: 2,
        unclear_pages: 0,
      },
    ],
    uploads: [],
  });
  await page.getByRole('button', { name: 'Asha' }).click();
  await expect(page.getByRole('button', { name: /EVS/ })).toContainText('My book');

  await page.getByRole('button', { name: /EVS/ }).click();
  await expect(page.getByRole('heading', { name: 'Chapters' })).toBeVisible();
  // A chapter still being read is not shown
  await expect(page.getByRole('button', { name: /Plants/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Chapter 2: Water/ }).click();

  const lesson = page.getByRole('button', { name: /Watch lesson/ });
  await expect(lesson).toContainText('Coming soon');
  await lesson.click();
  await expect(page.getByText('Coming soon! Read along for now.')).toBeVisible();
  await page.getByRole('button', { name: /Read along/ }).click();
  await expect(page).toHaveURL(/\/kid\/read-along\/ch-water$/);
});
