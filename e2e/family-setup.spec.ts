import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { FAKE_PIN, enterPin, installFakes, signInFamily } from './fakes';

/**
 * Plan 3.1: a new parent signs up, sets the PIN, adds 2 children (a 3rd is refused), picks a time
 * limit, then switches kid ↔ parent with the PIN; 5 wrong PINs lock parent mode.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([]);
}

async function addChild(page: Page, name: string, age: string, picture: string): Promise<void> {
  await page.getByLabel('First name').fill(name);
  await page.getByLabel('Age').fill(age);
  await page.getByRole('radio', { name: 'Class 3' }).check();
  await page.getByRole('radio', { name: picture }).check();
  await page.getByRole('button', { name: 'Save child' }).click();
  await expect(page.getByText(`${name} is added.`)).toBeVisible();
}

test('a new parent signs up, sets the PIN, adds 2 children and a time limit', async ({ page }) => {
  const server = await installFakes(page, { children: null, pinSet: false });
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue to email' }).click();

  // B1: choose and confirm; a mismatch starts again
  await expect(page).toHaveURL(/\/setup\/pin$/);
  await enterPin(page, '1111');
  await enterPin(page, '2222');
  await expect(page.getByText("Those PINs didn't match. Choose your PIN again.")).toBeVisible();
  await enterPin(page, FAKE_PIN);
  await expect(page.getByText('Enter the same PIN again.')).toBeVisible();
  await enterPin(page, FAKE_PIN);

  // B2: the form checks the fields, then two children; the subjects follow the class
  await expect(page).toHaveURL(/\/setup\/child$/);
  await page.getByRole('button', { name: 'Save child' }).click();
  await expect(page.getByText('This is required.').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Class 3' }).check();
  await expect(page.getByText('English, Hindi, Maths, EVS')).toBeVisible();
  await expectNoAxeViolations(page);
  await addChild(page, 'Asha', '8', 'Rabbit');
  await page.getByRole('button', { name: 'Add another child' }).click();
  await addChild(page, 'Ravi', '6', 'Lion');

  // A 3rd child is refused: no form, only the limit and Continue
  await expect(
    page.getByText('You have added 2 children, the most a family can have.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save child' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add another child' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue' }).click();

  // B3: books later (uploads arrive in Phase 5)
  await expect(page).toHaveURL(/\/setup\/books$/);
  await expect(page.getByText('Grade-level practice is ready even without a book.')).toBeVisible();
  await page.getByRole('button', { name: 'Later' }).click();

  // B4 → B5 → C1
  await expect(page).toHaveURL(/\/setup\/time-limit$/);
  await page.getByRole('radio', { name: '45 minutes' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/setup\/done$/);
  await expect(page.getByRole('heading', { name: 'All set!' })).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/who$/);
  await expect(page.getByRole('button', { name: 'Asha' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ravi' })).toBeVisible();

  expect(server.family.children.map((child) => child.first_name)).toEqual(['Asha', 'Ravi']);
  expect(server.family.dailyLimitMinutes).toBe(45);
  const childPosts = server.apiRequests.filter(
    (request) => request.method() === 'POST' && request.url().endsWith('/family/parent/children'),
  );
  // The grant from B1 goes with every setup write; each write carries its own key
  expect(childPosts.map((request) => request.headers()['x-parent-grant'])).toEqual([
    'fake-parent-grant',
    'fake-parent-grant',
  ]);
  expect(new Set(childPosts.map((request) => request.headers()['idempotency-key'])).size).toBe(2);

  // Setup ended parent mode: the Parent button asks for the PIN again
  await page.getByRole('button', { name: 'Parent mode' }).click();
  await expect(page).toHaveURL(/\/parent\/pin$/);
});

test('the first child can be added with the sign-in alone (Schema §11 "setup: T")', async ({
  page,
}) => {
  const server = await signInFamily(page, { children: [] });
  await expect(page).toHaveURL(/\/setup\/child$/);
  await addChild(page, 'Asha', '8', 'Rabbit');
  const post = server.apiRequests.find((request) =>
    request.url().endsWith('/family/parent/children'),
  );
  expect(post?.headers()['x-parent-grant']).toBeUndefined();

  // The second child needs the PIN: P0, then back to B2
  await page.getByRole('button', { name: 'Add another child' }).click();
  await page.getByLabel('First name').fill('Ravi');
  await page.getByLabel('Age').fill('6');
  await page.getByRole('radio', { name: 'Class 3' }).check();
  await page.getByRole('radio', { name: 'Lion' }).check();
  await page.getByRole('button', { name: 'Save child' }).click();
  await expect(page).toHaveURL(/\/parent\/pin\?next=%2Fsetup%2Fchild$/);
  await enterPin(page);
  await expect(page).toHaveURL(/\/setup\/child$/);
  expect(server.family.children).toHaveLength(1);
});

test('kid ↔ parent: a child picks a picture, the Parent button asks for the PIN', async ({
  page,
}) => {
  await signInFamily(page);
  await expect(page).toHaveURL(/\/who$/);
  await page.getByRole('button', { name: 'Asha' }).click();
  await expect(page).toHaveURL(/\/kid\/learn$/);
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'kid');

  await page.getByRole('button', { name: 'Parent mode' }).click();
  await expect(page).toHaveURL(/\/parent\/pin$/);
  await expectNoAxeViolations(page);
  await enterPin(page);
  await expect(page).toHaveURL(/\/parent\/progress$/);
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'parent');

  // Back to kids ends parent mode; going back needs the PIN again
  await page.getByRole('button', { name: 'Back to kids' }).click();
  await expect(page).toHaveURL(/\/who$/);
  await page.getByRole('button', { name: 'Parent mode' }).click();
  await expect(page).toHaveURL(/\/parent\/pin$/);
  await page.goBack();
  await page.goBack();
  await expect(page).not.toHaveURL(/\/parent\/progress$/);
});

test('kid and parent screens are guarded after a reload', async ({ page }) => {
  await signInFamily(page);
  await page.goto('/kid/learn');
  await expect(page).toHaveURL(/\/who$/);
  await page.goto('/parent/settings');
  await expect(page).toHaveURL(/\/parent\/pin\?next=%2Fparent%2Fsettings$/);
  await enterPin(page);
  await expect(page).toHaveURL(/\/parent\/settings$/);
});

test('5 wrong PINs lock parent mode; Forgot PIN sets a new one', async ({ page }) => {
  await signInFamily(page);
  await page.getByRole('button', { name: 'Parent mode' }).click();
  await expect(page).toHaveURL(/\/parent\/pin$/);

  for (let attempt = 1; attempt < 5; attempt++) {
    await enterPin(page, '0000');
    await expect(page.getByRole('alert')).toHaveText('That PIN is not right.');
  }
  await enterPin(page, '0000');
  await expect(page.getByRole('alert')).toHaveText(
    'Too many wrong PINs. Try again in 1 minute or use Forgot PIN.',
  );
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeDisabled();

  // A4: signed in moments ago, so the new PIN can be chosen straight away (Schema §8.2)
  await page.getByRole('link', { name: 'Forgot PIN?' }).click();
  await expect(page).toHaveURL(/\/parent\/forgot-pin$/);
  await enterPin(page, '5678');
  await enterPin(page, '5678');
  await expect(page).toHaveURL(/\/parent\/progress$/);
});
