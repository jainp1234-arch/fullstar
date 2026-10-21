import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { installFakes, signInFamily } from './fakes';

/** Plan 2.4: sign-in (A1–A3) through the Keycloak PKCE redirect, with Keycloak and the API faked. */
test.use({ viewport: { width: 390, height: 844 } });

test('signed out: family screens go to Welcome, which passes axe', async ({ page }) => {
  await installFakes(page);
  await page.goto('/kid/learn');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.locator('[data-screen]')).toHaveAttribute('data-screen', 'A1');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('sign up: consent first, then Keycloak, then the family is created and setup starts', async ({
  page,
}) => {
  const server = await installFakes(page, { children: null });
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/sign-up$/);

  const submit = page.getByRole('button', { name: 'Continue to email' });
  await submit.click();
  await expect(page.getByText('Please agree to continue.')).toBeVisible();
  await page.getByRole('checkbox').check();
  await submit.click();

  // Back from the (fake) Keycloak code page on A3, then on to B1
  await expect(page).toHaveURL(/\/setup\/pin$/);
  expect(server.createdFamilies).toEqual([{ consent_version: '2026-10-v1' }]);
  const create = server.apiRequests.find(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/family/me'),
  );
  expect(create?.headers()['authorization']).toMatch(/^Bearer /);
  expect(create?.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
});

test('sign in without a family asks for consent, then creates it', async ({ page }) => {
  const server = await signInFamily(page, { children: null });
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create family' }).click();
  await expect(page).toHaveURL(/\/setup\/pin$/);
  expect(server.createdFamilies).toHaveLength(1);
});

test('a returning family lands on Who is learning? with its children from /family/me', async ({
  page,
}) => {
  const server = await signInFamily(page);
  await expect(page).toHaveURL(/\/who$/);
  const me = server.apiRequests.find((request) => request.url().endsWith('/api/v1/family/me'));
  expect(me?.headers()['authorization']).toMatch(/^Bearer /);
  await expect(page.getByRole('button', { name: 'Asha' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ravi' })).toBeVisible();
  await page.getByRole('button', { name: 'Asha' }).click();
  await expect(page).toHaveURL(/\/kid\/learn$/);
});

test('the session survives a reload (refresh token in IndexedDB) and Welcome is skipped', async ({
  page,
}) => {
  await signInFamily(page);
  await page.reload();
  await expect(page).toHaveURL(/\/who$/);
  await page.goto('/welcome');
  await expect(page).toHaveURL(/\/who$/);
});

test('without a stored session the API is never called with a token', async ({ page }) => {
  const server = await installFakes(page);
  await page.goto('/sign-up');
  await expect(page.getByRole('button', { name: 'Continue to email' })).toBeEnabled();
  expect(server.apiRequests.every((request) => !request.headers()['authorization'])).toBe(true);
});
