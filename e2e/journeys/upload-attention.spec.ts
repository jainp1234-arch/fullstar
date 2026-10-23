import { expect, test } from '@playwright/test';
import { navigateInApp } from '../routes';
import {
  finishSetup,
  newEmail,
  pagePhoto,
  parentMode,
  signUp,
  skipWithoutStack,
  waitForMessage,
} from './stack';

/**
 * App Flow §8 "Upload needs attention" on the full stack: three blurry photos among clear ones,
 * read by the real book-reader (Tesseract), come back as unclear; the bell says so, P8 shows only
 * those pages, a new photo is taken for each, and the chapter is Getting ready again.
 */
skipWithoutStack();

test('Upload needs attention: unclear pages message, P8 retakes only those, Getting ready again', async ({
  page,
}) => {
  test.setTimeout(900_000);
  await signUp(page, newEmail('unclear'));
  await finishSetup(page, { name: 'Zoya', age: '8', picture: 'Rabbit' });
  await parentMode(page);
  await navigateInApp(page, '/parent/books');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'EVS' })
    .first()
    .getByRole('button', { name: 'Add first chapter' })
    .click();
  await page.getByLabel('Chapter name').fill('Water around us');
  const clear = pagePhoto('english-page.png');
  const blurry = pagePhoto('blurry-photo.jpg');
  await page
    .locator('app-upload-zone input[type="file"]')
    .last()
    .setInputFiles([
      { ...clear, name: 'page-1.png' },
      { ...blurry, name: 'page-2.jpg' },
      { ...blurry, name: 'page-3.jpg' },
      { ...blurry, name: 'page-4.jpg' },
    ]);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByText('Thank you. We are checking the pages now.', { exact: false }),
  ).toBeVisible({ timeout: 60_000 });

  await waitForMessage(page, 'Some pages of EVS chapter 1 are hard to read.', 400_000);
  await page.getByRole('button', { name: 'Open: Some pages are unclear' }).first().click();
  await expect(page).toHaveURL(/\/parent\/books\/evs\/fix-pages/);
  await expect(page.locator('app-page-thumb')).toHaveCount(3);

  for (let i = 0; i < 3; i++) {
    const retake = page.getByRole('button', { name: /^Retake page \d+$/ }).first();
    // The page number is in the button's accessible name, not its text
    const label = (await retake.getAttribute('aria-label')) ?? (await retake.textContent()) ?? '';
    const number = label.match(/\d+/)?.[0] ?? '';
    expect(number).not.toBe('');
    await retake.click();
    await expect(page.getByText(`New photo of page ${number}`)).toBeVisible();
    await page
      .locator('app-upload-zone input[type="file"]')
      .last()
      .setInputFiles([{ ...clear, name: `retake-${number}.png` }]);
    await expect(page.getByText(`Page ${number}: new photo sent.`, { exact: false })).toBeVisible({
      timeout: 60_000,
    });
  }
  await expect(page.getByText('All pages are clear. Thank you.')).toBeVisible();

  // Back on P4, once book-reader has read the new photos, nothing is left to fix
  const evs = page.getByRole('listitem').filter({ hasText: 'EVS' }).first();
  const fix = evs.getByRole('button', { name: /^Fix \d+ unclear pages?$/ });
  const deadline = Date.now() + 240_000;
  for (;;) {
    await navigateInApp(page, '/parent/books');
    await expect(evs).toBeVisible();
    console.log(`EVS row after the retakes: ${(await evs.textContent())?.replace(/\s+/g, ' ')}`);
    if ((await fix.count()) === 0) {
      break;
    }
    expect(Date.now(), 'the new photos are read within 4 minutes').toBeLessThan(deadline);
    await page.waitForTimeout(10_000);
    await navigateInApp(page, '/parent/progress');
  }
});
