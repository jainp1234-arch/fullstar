import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { finishSetup, newEmail, signIn, signUp, skipWithoutStack } from './stack';

/**
 * App Flow §8 "New parent signs up" and "Returning parent on a new phone" against the full stack:
 * real Keycloak codes from Mailpit, the real API, and the English book sent to ClamAV and book-reader.
 */
skipWithoutStack();
test.describe.configure({ mode: 'serial' });

const PAGES = join(__dirname, '../../services/book-reader/src/test/resources/pages');
const email = newEmail('parent');

test('New parent signs up: consent, emailed code, PIN, child, English book, 30 minutes, C1', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signUp(page, email);
  await finishSetup(
    page,
    { name: 'Meera', age: '8', picture: 'Rabbit' },
    {
      book: async (p) => {
        await p
          .getByRole('listitem')
          .filter({ hasText: 'English' })
          .getByRole('button', { name: 'Upload book' })
          .click();
        // The parent grant from B1 is still valid, so B3 opens the upload without the PIN
        await expect(p).toHaveURL(/\/parent\/books\/english\/upload/);
        const photo = readFileSync(join(PAGES, 'english-page.png'));
        await p
          .locator('app-upload-zone input[type="file"]')
          .last()
          .setInputFiles([
            { name: 'english-1.png', mimeType: 'image/png', buffer: photo },
            { name: 'english-2.png', mimeType: 'image/png', buffer: photo },
          ]);
        await p.getByRole('button', { name: 'Send' }).click();
        await expect(p.getByText('Thank you.', { exact: false })).toBeVisible({ timeout: 60_000 });
        await p.getByRole('button', { name: 'Back to books' }).click();
      },
    },
  );
});

test('Returning parent on a new phone: sign in lands on C1 with the children', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // A new phone: nothing of the first session on this device
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await expect(page.getByRole('button', { name: 'Meera' })).toBeVisible();
  await context.close();
});
