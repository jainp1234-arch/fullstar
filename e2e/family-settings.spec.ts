import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { FakeChild, signInFamily, unlockParent } from './fakes';

/**
 * Plan 3.2: Settings (P14), Edit child (P15: edit, remove, move to the next class with a warning),
 * Help (P16: FAQs, Contact us form) and Privacy (P17: deletion request, sent once).
 */
test.use({ viewport: { width: 390, height: 844 } });

const CHILDREN: FakeChild[] = [
  {
    id: 'child-asha',
    first_name: 'Asha',
    avatar_key: 'rabbit',
    age: 8,
    class_level: 3,
    progress: 12,
  },
  { id: 'child-ravi', first_name: 'Ravi', avatar_key: 'lion', age: 10, class_level: 5 },
];

async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([]);
}

test('P14 lists the children and saves the time limit, sound and celebrations', async ({
  page,
}) => {
  const server = await signInFamily(page, { children: CHILDREN });
  await unlockParent(page, '/parent/settings');
  await expect(page.getByRole('button', { name: /Asha.*Class 3 · 8 years/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ravi.*Class 5 · 10 years/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a child' })).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.getByRole('radio', { name: '20 minutes' }).check();
  await expect(page.getByText('Saved').first()).toBeVisible();
  await expect.poll(() => server.family.dailyLimitMinutes).toBe(20);

  const settings = () =>
    server.apiRequests.filter(
      (request) => request.method() === 'PATCH' && request.url().endsWith('/parent/settings'),
    );
  await page.getByRole('checkbox', { name: 'Celebrations' }).uncheck();
  await expect.poll(() => settings().length).toBe(2);
  expect(settings()[1].postDataJSON()).toEqual({ celebrations_enabled: false });
});

test('P15 edits a child, and moving to the next class warns before erasing progress', async ({
  page,
}) => {
  const server = await signInFamily(page, { children: CHILDREN });
  await unlockParent(page, '/parent/settings');
  await page.getByRole('button', { name: /Asha/ }).click();
  await expect(page).toHaveURL(/\/parent\/settings\/children\/child-asha$/);
  await expectNoAxeViolations(page);

  await page.getByLabel('First name').fill('Asha R');
  await page.getByRole('radio', { name: 'Panda' }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  expect(server.family.children[0]).toMatchObject({ first_name: 'Asha R', avatar_key: 'panda' });

  // The warning first; Keep progress changes nothing
  await page.getByRole('button', { name: 'Move to Class 4' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Erase Class 3 progress?' })).toBeVisible();
  await expect(
    dialog.getByText('This will erase all progress for Class 3. Continue?'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep progress' }).click();
  expect(server.family.children[0]).toMatchObject({ class_level: 3, progress: 12 });

  await page.getByRole('button', { name: 'Move to Class 4' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Erase progress' }).click();
  await expect(page.getByText('Asha R is now in Class 4.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Class 4' })).toBeVisible();
  expect(server.family.children[0]).toMatchObject({ class_level: 4, progress: 0 });
  const moves = server.apiRequests.filter((request) =>
    request.url().endsWith('/move-to-next-class'),
  );
  expect(moves).toHaveLength(1);
  expect(moves[0].headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
});

test('P15: Class 5 cannot move up; removing a child asks first, then a new one can be added', async ({
  page,
}) => {
  const server = await signInFamily(page, { children: CHILDREN });
  await unlockParent(page, '/parent/settings');
  await page.getByRole('button', { name: /Ravi/ }).click();
  await expect(page.getByText('This is the highest class we support for now.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Move to Class/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Remove child' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Remove Ravi?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove child' }).click();
  await expect(page).toHaveURL(/\/parent\/settings$/);
  await expect(page.getByText('Ravi is removed.')).toBeVisible();
  expect(server.family.children.map((child) => child.first_name)).toEqual(['Asha']);

  await page.getByRole('button', { name: 'Add a child' }).click();
  await expect(page).toHaveURL(/\/setup\/child\?next=%2Fparent%2Fsettings$/);
  await page.getByLabel('First name').fill('Meena');
  await page.getByLabel('Age').fill('6');
  await page.getByRole('radio', { name: 'Class 1' }).check();
  await page.getByRole('radio', { name: 'Cat' }).check();
  await page.getByRole('button', { name: 'Save child' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/parent\/settings$/);
  await expect(page.getByRole('button', { name: /Meena.*Class 1 · 6 years/ })).toBeVisible();
});

test('P16 shows the FAQs and the Contact us form, which cannot send yet', async ({ page }) => {
  await signInFamily(page);
  await unlockParent(page, '/parent/settings');
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/parent\/settings\/help$/);
  await page.getByText('How many children can I add?').click();
  await expect(page.getByText(/Up to 2\./)).toBeVisible();
  await page.getByLabel('Subject').fill('A question');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(
    page.getByText('Sending messages opens in a later update.', { exact: false }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test('P17: the deletion request is sent once and stays shown', async ({ page }) => {
  const server = await signInFamily(page);
  await unlockParent(page, '/parent/settings');
  await page.getByRole('button', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/parent\/settings\/privacy$/);
  await expect(page.getByRole('link', { name: 'Read the full privacy notice' })).toHaveAttribute(
    'href',
    'https://fullstar.example/privacy',
  );
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Request data deletion' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(server.family.deletionRequests).toBe(0);

  await page.getByRole('button', { name: 'Request data deletion' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Request deletion' }).click();
  await expect(page.getByText(/^Deletion requested on .+ within 30 days\.$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request data deletion' })).toHaveCount(0);

  // After a reload the request comes back from /family/me; no second request is possible
  await unlockParent(page, '/parent/settings/privacy');
  await expect(page.getByText(/^Deletion requested on /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request data deletion' })).toHaveCount(0);
  expect(server.family.deletionRequests).toBe(1);
});

test('Sign out ends the session', async ({ page }) => {
  await signInFamily(page);
  await unlockParent(page, '/parent/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/welcome$/);
});
