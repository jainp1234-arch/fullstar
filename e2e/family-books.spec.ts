import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { enterPin, signInFamily, unlockParent } from './fakes';

/** Plan 5.1: P4 books per child, P7 a 10-photo chapter, P5 a whole book, limits and sharing. */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);

function photos(
  count: number,
  prefix = 'page',
): { name: string; mimeType: string; buffer: Buffer }[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}-${i + 1}.jpg`,
    mimeType: 'image/jpeg',
    buffer: JPEG,
  }));
}

async function chooseFiles(page: Page, files: Parameters<Page['setInputFiles']>[1]): Promise<void> {
  await page.locator('app-upload-zone input[type="file"]').last().setInputFiles(files);
}

test('a parent adds a 10-photo chapter and it is sent for checking', async ({ page }) => {
  const server = await signInFamily(page);
  await unlockParent(page, '/parent/books');
  await expect(page.getByRole('tab', { name: 'Asha' })).toHaveAttribute('aria-selected', 'true');
  const evs = page.getByRole('listitem').filter({ hasText: 'EVS' }).first();
  await expect(evs.getByText('No book')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await evs.getByRole('button', { name: 'Add first chapter' }).click();
  await expect(page).toHaveURL(/\/parent\/books\/evs\/add-chapter\?child=child-asha$/);
  await page.getByLabel('Chapter name').fill('Plants around us');
  await chooseFiles(page, photos(10));
  await expect(page.getByText('10 photos ready')).toBeVisible();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByText('Thank you. We are checking the pages now.', { exact: false }),
  ).toBeVisible();
  expect(server.family.stored).toHaveLength(10);
  expect(server.family.books[0].uploads[0].status).toBe('scanning');

  await page.getByRole('button', { name: 'Back to books' }).click();
  await expect(page).toHaveURL(/\/parent\/books\?child=child-asha$/);
  const row = page.getByRole('listitem').filter({ hasText: 'EVS' }).first();
  await expect(row.getByText('Chapter 1: Plants around us')).toBeVisible();
  await expect(row.getByText('We are checking your upload.')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Add chapter' })).toBeVisible();
});

test('over-limit and fake files are refused', async ({ page }) => {
  await signInFamily(page);
  await unlockParent(page, '/parent/books/english/add-chapter');
  await page.getByLabel('Chapter name').fill('Nouns');
  await chooseFiles(page, photos(51));
  await expect(
    page.getByText('Please use a PDF (up to 50 MB, 300 pages)', { exact: false }),
  ).toBeVisible();
  await chooseFiles(page, [
    { name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(10_485_761) },
  ]);
  await expect(
    page.getByText('Please use a PDF (up to 50 MB, 300 pages)', { exact: false }),
  ).toBeVisible();
  await chooseFiles(page, [
    { name: 'book.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') },
    ...photos(1),
  ]);
  await expect(page.getByText('Choose either one PDF or photos, not both.')).toBeVisible();

  await chooseFiles(page, photos(2, 'not-a-photo'));
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByText('a file was not a real PDF or photo.', { exact: false }),
  ).toBeVisible();
});

test('a whole book is uploaded once, and shared with a sibling in the same class', async ({
  page,
}) => {
  const server = await signInFamily(page);
  await unlockParent(page, '/parent/books/maths/upload');
  await chooseFiles(page, [
    { name: 'maths.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fake') },
  ]);
  await expect(page.getByText('maths.pdf', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Thank you.', { exact: false })).toBeVisible();
  expect(server.family.books[0].upload_mode).toBe('whole');

  await page.getByRole('button', { name: 'Back to books' }).click();
  const maths = page.getByRole('listitem').filter({ hasText: 'Maths' }).first();
  await expect(maths.getByRole('button', { name: 'Upload book' })).toHaveCount(0);
  await maths.getByRole('button', { name: 'Use this book for Ravi too' }).click();
  await expect(page.getByText('Ravi can now use this book.')).toBeVisible();
  await expect(maths.getByText('Ravi uses this book too.')).toBeVisible();

  await page.getByRole('tab', { name: 'Ravi' }).click();
  await expect(page).toHaveURL(/child=child-ravi/);
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Maths' }).first().getByText('Getting ready'),
  ).toBeVisible();
});

test('B3 offers an upload for each subject and returns to setup', async ({ page }) => {
  await signInFamily(page);
  await page.goto('/setup/books');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Hindi' })
    .getByRole('button', { name: 'Upload book' })
    .click();
  // Uploading is parent mode: the PIN first, then back to the upload screen
  await expect(page).toHaveURL(/\/parent\/pin\?next=/);
  await enterPin(page);
  await expect(page).toHaveURL(
    /\/parent\/books\/hindi\/upload\?child=child-asha&next=%2Fsetup%2Fbooks$/,
  );
  await chooseFiles(page, photos(3));
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Back to books' }).click();
  await expect(page).toHaveURL(/\/setup\/books$/);
});
