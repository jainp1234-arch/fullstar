import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { FakeServer, signInFamily } from './fakes';
import { screensLoaded } from './offline';

/** Plan 6.3: K5 with stand-in audio; the highlight follows the word timings. */

function readyBook(server: FakeServer): void {
  server.family.books.push({
    id: 'book-evs',
    subject_id: 4,
    upload_mode: 'chapterwise',
    status: 'readalong_ready',
    class_level: 3,
    child_ids: ['child-asha'],
    chapters: [
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
}

async function openReadAlong(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Asha' }).click();
  await page.getByRole('button', { name: /EVS/ }).click();
  await page.getByRole('button', { name: /Chapter 2: Water/ }).click();
  await page.getByRole('button', { name: /Read along/ }).click();
  await expect(page).toHaveURL(/\/kid\/read-along\/ch-water\?back=/);
  await expect(page.getByRole('heading', { name: 'Water' })).toBeVisible();
}

test('the highlight follows the timings and a tapped word plays again', async ({ page }) => {
  const server = await signInFamily(page);
  readyBook(server);
  await openReadAlong(page);
  await expect(page.getByRole('progressbar', { name: 'Page 1 of 2' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Read to me' }).click();
  // Each word is lit for ~320 ms, so watch every frame in the page rather than poll from here
  const lit = (word: string) =>
    page.waitForFunction(
      (w) =>
        [...document.querySelectorAll('[aria-current="true"]')]
          .map((el) => el.textContent?.trim())
          .join() === w,
      word,
      { polling: 'raf', timeout: 5_000 },
    );
  await lit('Rain');
  await lit('falls');
  await lit('down.');

  // Tapping a word plays just that word
  await page.getByRole('button', { name: 'Hear "down." again' }).click();
  await expect(page.getByRole('button', { name: 'Hear "down." again' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Read to me' })).toBeVisible();

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('This page is not read aloud yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/\/kid\/well-done\?stars=1/);
  await expect
    .poll(() =>
      server.family.syncs.some((s) =>
        ((s.body['attempts'] ?? []) as Record<string, unknown>[]).some(
          (a) =>
            a['kind'] === 'readalong' && a['completed_at'] && a['family_chapter_id'] === 'ch-water',
        ),
      ),
    )
    .toBe(true);
});

test('an opened chapter reads again offline', async ({ page, context }) => {
  const server = await signInFamily(page);
  readyBook(server);
  await openReadAlong(page);
  await page.getByRole('button', { name: 'Close' }).click();
  // The fake API answers even offline, so its pages call fails as a lost connection would
  await screensLoaded(page);
  await context.setOffline(true);
  await page.route(/\/family\/kid\/chapters\/ch-water\/pages/, (route) =>
    route.abort('internetdisconnected'),
  );
  await page.getByRole('button', { name: /Read along/ }).click();
  await expect(page.getByText('Reading from this device.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('progressbar', { name: 'Page 1 of 2' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Page 1 of the book' })).toBeVisible();
});
