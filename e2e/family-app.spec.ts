import { expect, test } from '@playwright/test';

test('the family app opens on Who is learning?', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who is learning?');
  await expect(page).toHaveTitle('Who is learning? · FullStar');
});
