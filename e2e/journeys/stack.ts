import { Page, expect, test } from '@playwright/test';

/**
 * Plan 9.5: helpers for the App Flow §8 journeys against the full local stack (infra/journeys):
 * real Keycloak with its emailed codes caught by Mailpit, the real API and workers.
 * Opt-in: JOURNEYS=1 npx playwright test --project=journeys
 */
export const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://127.0.0.1:8025';
export const ADMIN_EMAIL = process.env['JOURNEY_ADMIN_EMAIL'] ?? 'admin@fullstar.test';
export const PIN = '2580';

export function skipWithoutStack(): void {
  test.skip(!process.env['JOURNEYS'], 'Set JOURNEYS=1 with the journey stack running');
}

/** A new address per test and run, so the journeys can run again on the same stack. */
export function newEmail(who: string): string {
  return `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@journeys.test`;
}

interface MailpitMessage {
  readonly ID: string;
  readonly Created: string;
  readonly To: readonly { readonly Address: string }[];
}

/** The 6-digit code in the newest email to this address sent after the given time. */
export async function codeFor(email: string, after: number): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json()) as {
      messages: MailpitMessage[];
    };
    const message = list.messages.find(
      (m) =>
        m.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()) &&
        Date.parse(m.Created) >= after - 1000,
    );
    if (message) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
        Text: string;
      };
      const code = /\b(\d{6})\b/.exec(full.Text)?.[1];
      if (code) {
        return code;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No code emailed to ${email} within 60 s`);
}

/** Keycloak's email page (A2) and code page (A3), through to the app. */
export async function enterEmailAndCode(page: Page, email: string): Promise<void> {
  await expect(page).toHaveURL(/\/auth\/realms\/fullstar\//);
  const sent = Date.now();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('#kc-send-code').click();
  const codeField = page.locator('input[name="code"]');
  await expect(codeField).toBeVisible();
  await codeField.fill(await codeFor(email, sent));
  await codeField.press('Enter');
  await expect(page).toHaveURL(/localhost:8080\/(?!auth\/)/);
}

/** A new family: Welcome → Sign up → consent → Keycloak → B1. */
export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue to email' }).click();
  await enterEmailAndCode(page, email);
  await expect(page).toHaveURL(/\/setup\/pin$/);
}

/** A returning family on a new device: Welcome → Sign in → Keycloak → C1. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await enterEmailAndCode(page, email);
  await expect(page).toHaveURL(/\/who$/);
}

/** Studio staff: S1 → Sign in → Keycloak → dashboard. */
export async function signInStaff(page: Page, email: string = ADMIN_EMAIL): Promise<void> {
  await page.goto('/studio/sign-in');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await enterEmailAndCode(page, email);
  await expect(page).toHaveURL(/\/studio\/dashboard$/);
}

/** Types the parent PIN on the pad (B1 asks twice). */
export async function typePin(page: Page, pin: string = PIN): Promise<void> {
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
}

/** B1 → B2 (one child, Class 3) → B3 later → B4 → B5 → C1, as App Flow §8 "New parent signs up". */
export async function finishSetup(
  page: Page,
  child: { name: string; age: string; picture: string },
  options: { book?: (page: Page) => Promise<void>; minutes?: string } = {},
): Promise<void> {
  await typePin(page);
  await typePin(page);
  await expect(page).toHaveURL(/\/setup\/child$/);
  await page.getByLabel('First name').fill(child.name);
  await page.getByLabel('Age').fill(child.age);
  await page.getByRole('radio', { name: 'Class 3' }).check();
  await page.getByRole('radio', { name: child.picture }).check();
  await page.getByRole('button', { name: 'Save child' }).click();
  await expect(page.getByText(`${child.name} is added.`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/setup\/books$/);
  if (options.book) {
    await options.book(page);
    await expect(page).toHaveURL(/\/setup\/books$/);
  }
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page).toHaveURL(/\/setup\/time-limit$/);
  await page.getByRole('radio', { name: options.minutes ?? '30 minutes' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/setup\/done$/);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/who$/);
  await expect(page.getByRole('button', { name: child.name })).toBeVisible();
}
