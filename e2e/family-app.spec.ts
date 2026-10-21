import { expect, test } from '@playwright/test';
import { installFakes } from './fakes';

test('signed out, the family app opens on Welcome', async ({ page }) => {
  await installFakes(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('FullStar');
  await expect(page).toHaveTitle('Welcome · FullStar');
});
