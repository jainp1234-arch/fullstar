import { readFileSync, rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Plan 2.4 "done when": a real sign-in with an emailed code on the laptop, through Caddy
 * (http://localhost:8080), Keycloak and the API, ending with GET /family/me.
 *
 * Opt-in: FULLSTAR_REAL_EMAIL=<address> FULLSTAR_CODE_FILE=<path> npx playwright test --project=real
 * When the code arrives by email, write it (6 digits) into FULLSTAR_CODE_FILE; the test waits
 * up to the code's 10-minute validity.
 */
const EMAIL = process.env['FULLSTAR_REAL_EMAIL'];
const CODE_FILE = process.env['FULLSTAR_CODE_FILE'];

test.skip(!EMAIL || !CODE_FILE, 'Set FULLSTAR_REAL_EMAIL and FULLSTAR_CODE_FILE to run');

async function readCode(): Promise<string> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const code = readFileSync(CODE_FILE ?? '', 'utf8').trim();
      if (/^\d{6}$/.test(code)) {
        return code;
      }
    } catch {
      // Not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('No code written in time');
}

test('sign in with a real email code and get /family/me', async ({ page }) => {
  test.setTimeout(12 * 60 * 1000);
  rmSync(CODE_FILE ?? '', { force: true });

  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Keycloak's email page (A2), then the code page (A3), served by the fullstar login theme
  await expect(page).toHaveURL(/\/auth\/realms\/fullstar\//);
  await page.locator('input[name="email"]').fill(EMAIL ?? '');
  await page.locator('#kc-send-code').click();
  const codeField = page.locator('input[name="code"]');
  await expect(codeField).toBeVisible();
  console.log('Code page reached: waiting for the emailed code in', CODE_FILE);

  const code = await readCode();
  const meResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/family/me') && response.request().method() === 'GET',
  );
  await codeField.fill(code);
  await codeField.press('Enter');

  const response = await meResponse;
  const body = (await response.json()) as {
    status: string;
    data: { family?: { pin_set: boolean }; children?: unknown[] } | null;
    error: { code: string } | null;
  };
  console.log(
    'GET /api/v1/family/me →',
    response.status(),
    body.status,
    body.error?.code ??
      `children: ${body.data?.children?.length}, pin_set: ${body.data?.family?.pin_set}`,
  );
  expect([200, 404]).toContain(response.status());
  expect(body.status).toBe(response.status() === 200 ? 'success' : 'error');
  if (response.status() === 404) {
    expect(body.error?.code).toBe('FAMILY_NOT_FOUND');
  }
  await expect(page).toHaveURL(/localhost:8080\/(who|sign-up|setup\/pin)$/);
});
