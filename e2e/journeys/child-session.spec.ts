import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Page, chromium, expect, test } from '@playwright/test';
import { finishSetup, newEmail, signIn, signUp, skipWithoutStack } from './stack';

/**
 * App Flow §8 "Child's session" on the full stack: the child picks their picture, watches a
 * seeded Class 3 English lesson to K7, practises a table and the 60-second challenge, then reads
 * today's story aloud. The story is spoken by espeak-ng (the reading-checker test image) and fed to
 * Chromium as the microphone, so the real reading-checker scores it (K14). Last, the time bar turns
 * red once the 30 minutes are used (the clock is run forward).
 */
skipWithoutStack();
test.describe.configure({ mode: 'serial' });

const email = newEmail('child');
const CHILD = 'Kiran';
const AUDIO = resolve('test-results/journeys');
let story = { text: '', lang: 'en' };

/** Answers the table question on screen: "a × b = ?" has the product among A–D. */
async function answerTable(page: Page): Promise<void> {
  const sum = await page
    .locator('app-question-card')
    .getByText(/\d+ × \d+ = \?/)
    .textContent();
  const [a, b] = (sum ?? '').match(/\d+/g)?.map(Number) ?? [0, 0];
  await page.getByRole('button', { name: new RegExp(`^[A-D]\\s?${a * b}$`) }).click();
}

test("Child's session: a lesson to K7, tables and the 60-second challenge", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, email);
  await finishSetup(page, { name: CHILD, age: '8', picture: 'Lion' });

  // C1 → K1
  await page.getByRole('button', { name: CHILD }).click();
  await expect(page.getByRole('heading', { name: `Hi ${CHILD}!` })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /Time today/ })).toBeVisible();

  // English → K2 → Nouns → K3 → the lesson (K4) to the end → K7
  await page.getByRole('button', { name: /English/ }).click();
  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
  await page.getByRole('button', { name: /Nouns/ }).click();
  await page.getByRole('button', { name: /Watch lesson/ }).click();
  await expect(page.getByText('Every person, place, animal and thing has a name.')).toBeVisible();
  for (let scene = 1; scene < 6; scene++) {
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/\/kid\/well-done\?stars=\d/);
  await expect(page.getByRole('heading', { name: /Well done!/ })).toBeVisible();

  // Practice → Tables (K10): the 7 times table, ten sums
  await page
    .getByRole('navigation', { name: /Kid/ })
    .getByRole('link', { name: 'Practice' })
    .click();
  await page.getByRole('button', { name: /Maths tables/ }).click();
  await expect(page).toHaveURL(/\/kid\/practice\/tables/);
  await page.getByRole('button', { name: '7 times table', exact: true }).click();
  await page.getByRole('button', { name: 'Practise' }).click();
  for (let i = 0; i < 10; i++) {
    await answerTable(page);
    await page.getByRole('button', { name: i < 9 ? 'Next' : 'Finish' }).click();
  }
  await expect(page.getByRole('heading', { name: /Well done!/ })).toBeVisible();

  // The 60-second challenge: as many right as possible until the minute is up
  await page.goBack();
  await page.getByRole('button', { name: '3 times table', exact: true }).click();
  await page.getByRole('button', { name: '60-second challenge' }).click();
  const until = Date.now() + 70_000;
  while (Date.now() < until) {
    if (await page.getByRole('heading', { name: /Well done!/ }).isVisible()) {
      break;
    }
    await answerTable(page).catch(() => undefined);
  }
  await expect(page.getByRole('heading', { name: /Well done!/ })).toBeVisible();

  // Read → K12 → K13: note today's story for the recording
  await page.getByRole('link', { name: 'Read' }).first().click();
  await expect(page).toHaveURL(/\/kid\/read$/);
  await page.getByRole('button', { name: 'Start reading' }).click();
  await expect(page).toHaveURL(/\/kid\/read\/test/);
  const passage = page.locator('p.passage');
  story = {
    text: ((await passage.textContent()) ?? '').trim(),
    lang: (await passage.getAttribute('lang')) ?? 'en',
  };
  expect(story.text.length).toBeGreaterThan(20);
});

test("Child's session: the story read aloud is scored with stars, then the time bar turns red", async () => {
  test.setTimeout(300_000);
  // The story spoken by espeak-ng (pinned in the reading-checker test image), as the microphone
  mkdirSync(AUDIO, { recursive: true });
  execFileSync('docker', [
    'run',
    '--rm',
    '-v',
    `${AUDIO}:/out`,
    'fullstar/reading-checker:test',
    'espeak-ng',
    '-v',
    story.lang === 'hi' ? 'hi' : 'en-gb',
    '-s',
    '120',
    '-w',
    '/out/story.wav',
    story.text,
  ]);
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${join(AUDIO, 'story.wav')}`,
    ],
  });
  const context = await browser.newContext({
    baseURL: 'http://localhost:8080',
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  // Kid-mode minutes are counted by a timer from the start; the test runs it forward later
  await page.clock.install();
  await signIn(page, email);
  await page.getByRole('button', { name: CHILD }).click();
  await page.getByRole('link', { name: 'Read' }).first().click();
  await page.getByRole('button', { name: 'Start reading' }).click();
  await expect(page.locator('p.passage')).toHaveText(story.text);

  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Recording…' })).toBeVisible();
  // espeak at 120 words a minute, and a little more
  const seconds = Math.ceil((story.text.split(/\s+/).length / 120) * 60) + 3;
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole('button', { name: "I'm done" }).click();

  // K14: the real reading-checker scored it
  await expect(page).toHaveURL(/\/kid\/read\/result\?test=/, { timeout: 30_000 });
  await expect(
    page.getByRole('heading', { name: /Well done! You got [1-3] stars?\./ }),
  ).toBeVisible({
    timeout: 90_000,
  });

  // 31 minutes in kid mode: the bar shows the limit is used; the child finishes and stops
  await page.getByRole('button', { name: 'Back to reading' }).click();
  await page.clock.runFor('31:00');
  const bar = page.getByRole('progressbar', { name: /Time today/ });
  await expect(bar).toHaveAttribute('aria-label', /Time today: (3[1-9]|[4-9]\d) of 30 minutes/);
  await expect(page.locator('.time__fill--over')).toBeVisible();
  await context.close();
  await browser.close();
});
