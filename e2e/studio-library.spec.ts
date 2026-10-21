import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { signInStudio } from './fakes';

/** Plan 4.2: S3 library tree, S5 editors with versions, and the kid-mode preview. */

async function openEvs(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Library' })
    .click();
  await page.getByRole('combobox', { name: 'Class' }).selectOption('3');
  await page.getByRole('combobox', { name: 'Subject' }).selectOption('evs');
  await expect(page.getByRole('button', { name: /^Water/ })).toBeVisible();
}

test('the library shows the topic tree and topics can be added and renamed', async ({ page }) => {
  const server = await signInStudio(page);
  await openEvs(page);
  await expect(page.getByRole('button', { name: /^Saving water/ })).toBeVisible();

  await page.getByRole('button', { name: /^Water/ }).click();
  await expect(page.getByRole('cell', { name: 'Birds and nests', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add a topic under Water' }).click();
  await page.getByLabel('Add a topic under Water').fill('Saving water');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('A topic with this name is already here.')).toBeVisible();
  await page.getByLabel('Add a topic under Water').fill('Rain');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Rain/ })).toHaveAttribute('aria-current', 'true');
  expect(server.content.topics.find((t) => t.name === 'Rain')?.parent_id).toBe('t1');

  await page.getByRole('button', { name: 'Rename Rain' }).click();
  await page.getByLabel('Rename Rain').fill('Rain and clouds');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Rain and clouds/ })).toBeVisible();
  await expect(page).toHaveURL(/class=3&subject=evs&topic=/);
  // The rename dialog's backdrop fades out; checking contrast through it fails at random
  await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('saving creates a new version and old versions open read-only', async ({ page }) => {
  const server = await signInStudio(page);
  await openEvs(page);
  await page.getByRole('button', { name: /^Water/ }).click();
  await page.getByRole('button', { name: 'Open Birds and nests' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/sample\/edit$/);

  const preview = page.getByRole('region', { name: 'Preview as a child sees it' });
  await expect(preview.getByText('A bird builds a nest.')).toBeVisible();
  const narration = page.getByLabel('Narration (shown and read aloud)').first();
  await narration.fill('A bird builds a cosy nest.');
  await expect(preview.getByText('A bird builds a cosy nest.')).toBeVisible();

  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText('Saved as version 3.')).toBeVisible();
  const sample = server.content.items.find((item) => item.id === 'sample');
  expect(sample?.versions).toHaveLength(3);
  expect(sample?.current_version_id).toBe('sample-v3');

  await page.getByRole('button', { name: /^Version 1 by Meera/ }).click();
  await expect(
    page.getByText("You're looking at version 1. Saved versions can't be changed."),
  ).toBeVisible();
  await expect(page.getByLabel('Narration (shown and read aloud)').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save new version' })).toBeDisabled();
  await expect(preview.getByText('A bird makes a nest.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to the current version' }).click();
  await expect(page.getByLabel('Narration (shown and read aloud)').first()).toHaveValue(
    'A bird builds a cosy nest.',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('a new lesson shows field errors from the API, then saves as version 1', async ({ page }) => {
  await signInStudio(page);
  await openEvs(page);
  await page.getByRole('button', { name: /^Water/ }).click();
  await page.getByRole('button', { name: 'New lesson' }).click();
  await expect(page).toHaveURL(/\/studio\/library\/new\/edit\?kind=lesson/);

  await page.getByLabel('Title').fill('Clouds');
  await page.getByRole('button', { name: 'Save first version' }).click();
  await expect(page.getByText('Some fields need attention.')).toBeVisible();
  await expect(page.getByText('This is required.')).toBeVisible();

  await page.getByLabel('Narration (shown and read aloud)').fill('Clouds are made of tiny drops.');
  await page.getByLabel('Picture').selectOption({ label: 'EVS seedling' });
  await page.getByRole('button', { name: 'Save first version' }).click();
  await expect(page.getByText('Saved as version 1.')).toBeVisible();
  await expect(page).toHaveURL(/\/studio\/library\/c-[^/]+\/edit$/);
});

test('a new multiple-choice question previews like a child sees it', async ({ page }) => {
  await signInStudio(page);
  await openEvs(page);
  await page.getByRole('button', { name: /^Water/ }).click();
  await page.getByRole('button', { name: 'New question' }).click();
  await page.getByLabel('Question', { exact: true }).fill('Where does a fish live?');
  await page.getByLabel('Answer A', { exact: true }).fill('In a tree');
  await page.getByLabel('Answer B', { exact: true }).fill('In water');
  await page.getByLabel('Right answer').selectOption({ label: 'Answer B: In water' });
  await page.getByLabel('Explanation shown after answering').fill('Fish need water to breathe.');

  const preview = page.getByRole('region', { name: 'Preview as a child sees it' });
  await expect(preview.getByText('Where does a fish live?')).toBeVisible();
  await preview.getByRole('button', { name: /In a tree/ }).click();
  await expect(preview.getByText('Try again.')).toBeVisible();
  await preview.getByRole('button', { name: /In water/ }).click();
  await expect(preview.getByText('Well done! Fish need water to breathe.')).toBeVisible();
  await expect(preview.locator('app-content-preview')).toHaveAttribute('data-mode', 'kid');
});
