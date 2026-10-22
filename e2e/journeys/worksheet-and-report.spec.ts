import { Page, expect, test } from '@playwright/test';
import { navigateInApp } from '../routes';
import {
  finishSetup,
  newEmail,
  parentMode,
  signInStaff,
  signUp,
  skipWithoutStack,
  waitForMessage,
} from './stack';

/**
 * App Flow §8 "Parent prints and checks a worksheet" and "Parent reports a problem" on the full
 * stack: a Maths worksheet from the seeded Class 3 questions, its PDF from the real Gotenberg, a weak
 * spot that shows in Progress, then a reported question that a teacher marks fixed in S7.
 * (The seeded Class 3 content has no book chapters, so the worksheet is from a topic; a parent
 * reports from the worksheet solutions, the parent-mode screen that shows content.)
 */
skipWithoutStack();
test.describe.configure({ mode: 'serial' });

const email = newEmail('worksheet');
const CHILD = 'Arjun';
const MATHS = '3';
let parent: Page;
let reported = '';

test.beforeAll(async ({ browser }) => {
  parent = await (await browser.newContext({ baseURL: 'http://localhost:8080' })).newPage();
});

test('Parent prints and checks a worksheet: P10 → P11 → P12 PDF → P13 weak spot → P1', async () => {
  test.setTimeout(240_000);
  await signUp(parent, email);
  await finishSetup(parent, { name: CHILD, age: '8', picture: 'Lion' });
  await parentMode(parent);
  await navigateInApp(parent, '/parent/worksheets');
  await parent.getByRole('button', { name: /Create (your first )?worksheet/ }).click();
  await expect(parent).toHaveURL(/\/parent\/worksheets\/new$/);
  await parent.getByRole('combobox', { name: 'Subject' }).selectOption(MATHS);
  await parent.getByRole('combobox', { name: 'Questions from' }).selectOption('topic');
  await expect(parent.getByRole('combobox', { name: 'Topic' })).toBeEnabled();
  await parent.getByRole('combobox', { name: 'Topic' }).selectOption({ label: 'Addition' });
  await parent.getByRole('combobox', { name: 'Number of questions' }).selectOption('5');
  await parent.getByRole('button', { name: 'Create worksheet' }).click();
  await expect(parent.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(parent.locator('ol li')).toHaveCount(5);

  // P12: the PDF is made by the real Gotenberg
  await parent.getByRole('button', { name: 'Print / share' }).click();
  await expect(parent).toHaveURL(/\/parent\/worksheets\/[^/]+\/print$/);
  const download = parent.getByRole('link', { name: 'Download PDF' });
  await expect(download).toBeVisible({ timeout: 60_000 });
  // The app hands the downloaded PDF over as a blob: URL, so read its first bytes in the page
  const head = await parent.evaluate(
    async (href) => {
      const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
      return new TextDecoder().decode(bytes.slice(0, 4));
    },
    (await download.getAttribute('href')) ?? '',
  );
  expect(head).toBe('%PDF');

  // P13: after the child has done it, the parent ticks a weak spot
  const print = new URL(parent.url()).pathname;
  await navigateInApp(parent, print.replace(/\/print$/, '/solutions'));
  await parent.getByRole('checkbox', { name: 'Addition' }).check();
  await parent.getByRole('button', { name: 'Save' }).click();
  await expect(parent.getByText('Saved.')).toBeVisible();

  // P1: Areas to work on
  await navigateInApp(parent, '/parent/progress');
  await expect(parent.getByText('Areas to work on')).toBeVisible();
  await expect(parent.getByText('Addition · Maths')).toBeVisible();

  // Back on P13, a question looks wrong to the parent
  await navigateInApp(parent, print.replace(/\/print$/, '/solutions'));
  const report = parent.getByRole('button', { name: /^Report a problem: / }).first();
  reported = ((await report.getAttribute('aria-label')) ?? (await report.textContent()) ?? '')
    .replace(/^Report a problem: /, '')
    .trim();
  await report.click();
  await expect(parent).toHaveURL(/\/parent\/report\?item=/);
  await parent.getByRole('combobox', { name: 'Reason' }).selectOption('spelling');
  await parent.getByLabel('What did you notice? (optional)').fill('A word is spelt wrong.');
  await parent.getByRole('button', { name: 'Send report' }).click();
  await expect(
    parent.getByText('Thank you. We will let you know when it is fixed.', { exact: false }),
  ).toBeVisible();
});

test('Parent reports a problem: the teacher sees it in S7, marks it fixed, the family is told', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const studio = await (await browser.newContext({ baseURL: 'http://localhost:8080' })).newPage();
  await signInStaff(studio);
  await studio
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Reports' })
    .click();
  await expect(studio).toHaveURL(/\/studio\/reports/);
  await studio
    .getByRole('button', { name: `Mark fixed: ${reported}` })
    .first()
    .click();
  await expect(studio.getByText('Marked fixed. The family has been told.')).toBeVisible();
  await studio.context().close();

  await waitForMessage(parent, 'The question you reported has been fixed.', 120_000);
  await parent.context().close();
});
