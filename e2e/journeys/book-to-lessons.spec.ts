import { Browser, Page, expect, test } from '@playwright/test';
import { navigateInApp } from '../routes';
import {
  finishSetup,
  newEmail,
  pagePhoto,
  parentMode,
  signInStaff,
  signUp,
  skipWithoutStack,
  waitForMessage,
} from './stack';

/**
 * App Flow §8 "Parent adds a chapter" with "Admin prepares an uploaded book" on the full stack:
 * six Hindi photos go through ClamAV and book-reader (real OCR), the narration stand-in, the bell
 * message, the Studio prep queue (S8/S9) with Claude drafts (stand-in) whose content check finds a
 * wrong answer (fixed) and a misspelling (accepted with a note), publishing, Mark chapter ready, and
 * the parent's preview (P8a).
 */
skipWithoutStack();
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const email = newEmail('book');
const CHILD = 'Tara';
const CHAPTER = `Rain ${stamp}`;
let parent: Page;

async function staffPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' });
  const page = await context.newPage();
  await signInStaff(page);
  return page;
}

/** S11 with the agent on: runs the check and waits for its result line. */
async function runCheck(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Run content check' }).click();
  const result = page.getByText(/Check (passed|failed) · \d+ critical, \d+ warnings?/);
  await expect(result).toBeVisible({ timeout: 60_000 });
  return (await result.textContent()) ?? '';
}

async function publishFromCheck(page: Page): Promise<void> {
  await expect(page.getByText('Ready to publish.')).toBeVisible();
  await page.getByRole('button', { name: 'Go to publish' }).click();
  await page.getByRole('button', { name: 'Publish current version' }).click();
  await expect(page.getByText('Published. Children can see it now.')).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' });
  parent = await context.newPage();
});

test('Parent adds a chapter: Hindi, six photos, Getting ready', async () => {
  test.setTimeout(240_000);
  await signUp(parent, email);
  await finishSetup(parent, { name: CHILD, age: '8', picture: 'Rabbit' });
  await parentMode(parent);
  await navigateInApp(parent, '/parent/books');
  const hindi = parent.getByRole('listitem').filter({ hasText: 'Hindi' }).first();
  await hindi.getByRole('button', { name: 'Add first chapter' }).click();
  await expect(parent).toHaveURL(/\/parent\/books\/hindi\/add-chapter/);
  await parent.getByLabel('Chapter name').fill(CHAPTER);
  const photo = pagePhoto('hindi-page.png');
  await parent
    .locator('app-upload-zone input[type="file"]')
    .last()
    .setInputFiles(Array.from({ length: 6 }, (_, i) => ({ ...photo, name: `hindi-${i + 1}.png` })));
  await expect(parent.getByText('6 photos ready')).toBeVisible();
  await parent.getByRole('button', { name: 'Send' }).click();
  await expect(
    parent.getByText('Thank you. We are checking the pages now.', { exact: false }),
  ).toBeVisible({ timeout: 60_000 });
  await parent.getByRole('button', { name: 'Back to books' }).click();
  await expect(
    parent
      .getByRole('listitem')
      .filter({ hasText: 'Hindi' })
      .first()
      .getByText('Getting ready')
      .first(),
  ).toBeVisible();
});

test('the bell says the chapter is ready to read along', async () => {
  test.setTimeout(420_000);
  // book-reader reads the photos, the narration stand-in voices the pages
  await waitForMessage(parent, 'Hindi Ch 1 is ready to read along.', 400_000);
});

test('Admin prepares it: S8 claim, S9 link, Claude drafts, content check, publish, mark ready', async ({
  browser,
}) => {
  test.setTimeout(1_200_000);
  const studio = await staffPage(browser);
  await studio
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Uploads queue' })
    .click();
  const row = studio.getByRole('listitem').filter({ hasText: `Ch 1: ${CHAPTER}` });
  await row.getByRole('button', { name: 'Claim' }).click();
  await expect(studio).toHaveURL(/\/studio\/uploads\/[^/]+\/prepare$/);
  const prepare = new URL(studio.url()).pathname;

  await studio.getByLabel('Find a prepared book').fill(`journey ${stamp}`);
  await studio.getByRole('button', { name: 'Search' }).click();
  await expect(studio.getByText('No prepared book found. Create one.')).toBeVisible();
  await studio.getByLabel('Book title').fill(`Journey Hindi ${stamp}`);
  await studio.getByRole('button', { name: 'Create book' }).click();
  await expect(studio.getByLabel('Chapter name')).toHaveValue(CHAPTER);
  await studio.getByRole('button', { name: 'Add chapter' }).click();
  await studio.getByRole('button', { name: `Link ${CHAPTER}` }).click();
  await expect(studio.getByText(`Linked to ${CHAPTER}.`)).toBeVisible();

  // The lesson: Claude drafts it from the chapter text; the check finds one warning, accepted
  await studio.getByRole('button', { name: 'Draft lesson with Claude' }).click();
  await expect(
    studio.getByText('Drafting for an uploaded chapter', { exact: false }),
  ).toBeVisible();
  await studio.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await studio
    .getByRole('button', { name: /^Open .* in the editor$/ })
    .first()
    .click();
  await studio.getByRole('button', { name: 'Save first version' }).click();
  await expect(studio.getByText('Saved as version 1.')).toBeVisible();
  await studio.getByRole('button', { name: 'Content check' }).click();
  expect(await runCheck(studio)).toMatch(/passed · 0 critical, 1 warning/);
  await studio.getByRole('button', { name: 'Accept with note' }).click();
  const dialog = studio.getByRole('dialog');
  await dialog.getByLabel('Note (why it is fine)').fill('The typo is in a warm-up line we keep.');
  await dialog.getByRole('button', { name: 'Accept' }).click();
  await publishFromCheck(studio);

  // 20 questions: one has a wrong answer, which the check stops until it is fixed in S5
  await navigateInApp(studio, prepare);
  await studio.getByRole('button', { name: 'Draft questions with Claude' }).click();
  // The drafts go to the topic chosen here; the loop below finds them there in the Library
  const topic = await studio
    .getByRole('combobox', { name: 'Topic' })
    .evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent?.trim() ?? '');
  await studio.getByRole('combobox', { name: 'Number of questions' }).selectOption('20');
  await studio.getByRole('button', { name: 'Draft with AI', exact: true }).click();
  await studio.getByRole('button', { name: 'Save 20 ready questions as drafts' }).click();
  await expect(studio.getByText('Saved 20 questions as drafts.')).toBeVisible();

  // Each draft: S3 → open it (S5) → Content check (S11) → publish (S6)
  let fixed = 0;
  for (let i = 0; i < 25; i++) {
    const started = Date.now();
    await studio
      .getByRole('navigation', { name: 'Studio' })
      .getByRole('link', { name: 'Library' })
      .click();
    await studio.getByRole('combobox', { name: 'Class' }).selectOption('3');
    await studio.getByRole('combobox', { name: 'Subject' }).selectOption('hindi');
    await studio.getByRole('button', { name: new RegExp(`^${topic}`) }).click();
    const draft = studio.getByRole('row').filter({ hasText: 'Draft' }).first();
    // The table loads after the screen does: give it time before deciding no draft is left
    const left = await draft
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!left) {
      break;
    }
    await draft.getByRole('button', { name: /^Open / }).click();
    await expect(studio).toHaveURL(/\/studio\/library\/[^/]+\/edit/);
    await studio.getByRole('button', { name: 'Content check' }).click();
    if (/failed · 1 critical/.test(await runCheck(studio))) {
      const item = new URL(studio.url()).searchParams.get('item');
      await navigateInApp(studio, `/studio/library/${item}/edit`);
      // The right answer is listed by its letter and text: choose the one that says Five
      const right = studio.getByLabel('Right answer');
      // The options are built from the answers once the item has loaded
      await expect(right.locator('option', { hasText: 'Five' })).toHaveCount(1, {
        timeout: 15_000,
      });
      const five = (await right.locator('option').allTextContents()).find((o) =>
        o.includes('Five'),
      );
      await right.selectOption({ label: (five ?? '').trim() });
      await studio.getByLabel('Explanation shown after answering').fill('Two and three make five.');
      await studio.getByRole('button', { name: 'Save new version' }).click();
      await expect(studio.getByText('Saved as version 2.')).toBeVisible();
      await studio.getByRole('button', { name: 'Content check' }).click();
      expect(await runCheck(studio)).toMatch(/passed · 0 critical/);
      fixed++;
    }
    await publishFromCheck(studio);
    console.log(
      `Question ${i + 1} checked and published in ${Math.round((Date.now() - started) / 1000)} s`,
    );
  }
  expect(fixed).toBe(1);

  await navigateInApp(studio, prepare);
  await expect(studio.getByText(/1 published lesson, 20 published questions/)).toBeVisible();
  await studio.getByRole('button', { name: 'Mark chapter ready' }).click();
  await expect(studio.getByText('Chapter ready. Every linked family has been told.')).toBeVisible();
  await studio.context().close();
});

test('the parent is told the lessons are ready and previews one: Looks good', async () => {
  test.setTimeout(180_000);
  await waitForMessage(parent, 'Lessons for Hindi Ch 1 are ready. We recommend a quick preview.');
  await parent.getByRole('button', { name: 'Open: Lessons ready' }).first().click();
  await expect(parent).toHaveURL(/\/parent\/books\/hindi\/preview/);
  await expect(parent.getByText('New · preview recommended')).toBeVisible();
  await parent
    .getByRole('button', { name: /^Preview / })
    .first()
    .click();
  await parent.getByRole('button', { name: 'Looks good' }).click();
  await expect(parent.getByText('Thank you for checking.')).toBeVisible();
  await parent.context().close();
});
