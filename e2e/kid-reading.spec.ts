import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { FakeServer, enterPin, signInFamily } from './fakes';
import { fakeMicrophone } from './microphone';
import { navigateInApp } from './routes';

/** Plan 8.3: K12 reading home, K13 recording, K14 result, P3 history; microphone and limits. */

async function openReading(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Asha' }).click();
  await page.getByRole('link', { name: 'Read' }).first().click();
  await expect(page).toHaveURL(/\/kid\/read$/);
}

async function read(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Recording…' })).toBeVisible();
  await page.getByRole('button', { name: "I'm done" }).click();
}

function scoredTests(server: FakeServer) {
  return server.reading.tests.filter((t) => t.status === 'scored');
}

test('the first story: K12 invites, K13 records, K14 shows stars and words to practise', async ({
  page,
}) => {
  await fakeMicrophone(page);
  const server = await signInFamily(page);
  await openReading(page);
  await expect(page.getByRole('heading', { name: "Let's read your first story!" })).toBeVisible();
  await expect(page.getByRole('img', { name: 'A small seedling' })).toBeVisible();
  await expect(page.getByText('Reading level 1')).toBeVisible();
  await expect(page.getByText('Read a story to find words to practise.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Start reading' }).click();
  await expect(page).toHaveURL(/\/kid\/read\/test$/);
  await expect(page.getByText(/^Ravi has a red kite\./)).toBeVisible();
  await expect(
    page.getByText('Tap the microphone, then read the story aloud.', { exact: false }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await read(page);

  await expect(page).toHaveURL(/\/kid\/read\/result\?test=/);
  await expect(page.getByRole('heading', { name: 'Well done! You got 3 stars.' })).toBeVisible();
  await expect(page.getByText('You read 14 of 16 words well.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'red' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'park' })).toBeVisible();
  expect(server.family.stored).toContain(
    `/fake-storage/recordings/${server.reading.tests[0].id}.webm`,
  );
  expect(server.reading.tests[0].recording_type).toBe('audio/webm');
  expect(scoredTests(server)).toHaveLength(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // One retry a day: Read again is offered once, then K12 says to come back tomorrow
  await page.getByRole('button', { name: 'Back to reading' }).click();
  await expect(page.getByText("Today's story · English")).toBeVisible();
  await expect(page.getByText('1 try left today')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'park' })).toBeVisible();
  await page.getByRole('button', { name: 'Start reading' }).click();
  await read(page);
  await expect(page.getByRole('heading', { name: 'Well done! You got 3 stars.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read again' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to reading' }).click();
  await expect(page.getByText('Come back tomorrow for the next story.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start reading' })).toHaveCount(0);
});

test('a recording that is not understood gets no score and a retry', async ({ page }) => {
  await fakeMicrophone(page);
  const server = await signInFamily(page);
  server.reading.outcome = 'not_understood';
  await openReading(page);
  await page.getByRole('button', { name: 'Start reading' }).click();
  await read(page);
  await expect(page.getByRole('heading', { name: "Let's try again." })).toBeVisible();
  await expect(
    page.getByText("We couldn't hear the reading clearly, so there is no score this time."),
  ).toBeVisible();
  await expect(page.getByText(/You got \d stars?/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Read again' }).click();
  await expect(page).toHaveURL(/\/kid\/read\/test$/);
});

test('a refused microphone asks for a parent, with the steps for them', async ({ page }) => {
  await fakeMicrophone(page, true);
  await signInFamily(page);
  await openReading(page);
  await page.getByRole('button', { name: 'Start reading' }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByText('Ask Mummy/Papa to turn on the microphone.')).toBeVisible();
  await expect(page.getByText(/^For a parent: tap the lock next to the web address/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('P1 shows the latest reading and P3 the history with the recording', async ({ page }) => {
  await fakeMicrophone(page);
  await signInFamily(page);
  await openReading(page);
  await page.getByRole('button', { name: 'Start reading' }).click();
  await read(page);
  await expect(page.getByText('You read 14 of 16 words well.')).toBeVisible();
  await navigateInApp(page, '/kid/learn');
  await page.getByRole('button', { name: 'Parent mode' }).click();
  await enterPin(page);
  await expect(page).toHaveURL(/\/parent\/progress$/);
  await expect(page.getByText('Latest: 96 words a minute, 88% read well')).toBeVisible();
  await page.getByRole('button', { name: /Reading history/ }).click();
  await expect(page).toHaveURL(/\/parent\/progress\/reading\?child=child-asha$/);
  await expect(page.getByText('96 words a minute · 88% read well')).toBeVisible();
  await expect(page.getByText('Words to practise: red, park')).toBeVisible();
  await expect(page.locator('audio')).toHaveAttribute('src', /\/fake-storage\/recordings\//);
  await expect(page.getByText(/^Recording kept until /)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
