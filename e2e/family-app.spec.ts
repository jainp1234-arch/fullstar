import { expect, test } from '@playwright/test';

test('family-app shows the hello heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello, family-app');
});
