import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInStudio } from './fakes';
import { navigateInApp } from './routes';

/** Plan 4.1: S2 dashboard counts and S13 staff (super admin only). */

test('the dashboard shows the counts and each card opens its queue', async ({ page }) => {
  await signInStudio(page);
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
  for (const label of [
    '3 new uploads to prepare',
    '1 draft in progress',
    '4 published in the last 7 days',
    '2 open problem reports',
    '1 open support ticket',
  ]) {
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
  await page.getByRole('button', { name: '1 open support ticket' }).click();
  await expect(page).toHaveURL(/\/studio\/support$/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('a content admin has no Staff page', async ({ page }) => {
  await signInStudio(page);
  const nav = page.getByRole('navigation', { name: 'Studio' });
  await expect(nav.getByRole('link', { name: 'Library' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Staff' })).toHaveCount(0);
  await navigateInApp(page, '/studio/staff').catch(() => undefined);
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
});

test('a super admin adds a staff member and changes a role, but not their own', async ({
  page,
}) => {
  const server = await signInStudio(page, { staffRole: 'super_admin' });
  await page
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Staff' })
    .click();
  await expect(page).toHaveURL(/\/studio\/staff$/);
  await expect(page.getByRole('cell', { name: 'Meera (You)' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole('button', { name: 'Add staff member' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Asha Rao');
  await dialog.getByLabel('Email address').fill('meera@example.com');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('This person is already on the staff list.')).toBeVisible();
  await dialog.getByLabel('Email address').fill('asha@example.com');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Asha Rao can now sign in to the Studio.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Asha Rao', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Change Asha Rao' }).click();
  await dialog.getByLabel('Super admin').check();
  await dialog.getByLabel('Can sign in to the Studio').uncheck();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();
  const asha = server.staff.find((member) => member.display_name === 'Asha Rao');
  expect(asha).toMatchObject({ role: 'super_admin', active: false });
  await expect(page.getByRole('row', { name: /Asha Rao/ })).toContainText('Switched off');

  await page.getByRole('button', { name: 'Change Meera' }).click();
  await expect(dialog.getByLabel('Content admin')).toBeDisabled();
  await expect(dialog.getByLabel('Can sign in to the Studio')).toBeDisabled();
  await expect(
    dialog.getByText("You can't change your own role or switch yourself off."),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(server.staff[0]).toMatchObject({ role: 'super_admin', active: true });
});
