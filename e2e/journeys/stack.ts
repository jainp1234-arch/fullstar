import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Page, expect, test } from '@playwright/test';
import { navigateInApp } from '../routes';

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
}

/** Keycloak's email page (A2) and code page (A3), through to the app (families). */
async function emailCodeToApp(page: Page, email: string): Promise<void> {
  await enterEmailAndCode(page, email);
  await expect(page).toHaveURL(/localhost:8080\/(?!auth\/)/);
}

/**
 * Staff also need an authenticator app (Schema §8.3: email code, then TOTP; the first sign-in sets it
 * up). The journeys keep the secret in a temp file, so every later sign-in, and the next run on the
 * same stack, can make codes (RFC 6238 with Keycloak's default policy: SHA-1, 6 digits, 30 s).
 */
const TOTP_FILE = join(tmpdir(), 'fullstar-journeys-staff-totp.json');

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/[\s=]/g, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

function totp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}

/** A code from a time step not used before: Keycloak refuses a code used twice. */
async function freshCode(
  secret: string,
  lastUsed: number,
): Promise<{ code: string; counter: number }> {
  let counter = Math.floor(Date.now() / 30_000);
  while (counter <= lastUsed) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    counter = Math.floor(Date.now() / 30_000);
  }
  return { code: totp(secret, counter), counter };
}

function savedTotp(email: string): { secret: string; lastUsed: number } | null {
  if (!existsSync(TOTP_FILE)) {
    return null;
  }
  const all = JSON.parse(readFileSync(TOTP_FILE, 'utf8')) as Record<
    string,
    { secret: string; lastUsed: number }
  >;
  return all[email] ?? null;
}

function saveTotp(email: string, secret: string, lastUsed: number): void {
  const all = existsSync(TOTP_FILE)
    ? (JSON.parse(readFileSync(TOTP_FILE, 'utf8')) as Record<string, unknown>)
    : {};
  writeFileSync(TOTP_FILE, JSON.stringify({ ...all, [email]: { secret, lastUsed } }));
}

async function staffSecondFactor(page: Page, email: string): Promise<void> {
  const setup = page.locator('#totp');
  const otp = page.locator('#otp');
  await expect(setup.or(otp)).toBeVisible();
  if (await setup.isVisible()) {
    // First sign-in: Keycloak shows the key under "Unable to scan?"
    await page.getByText('Unable to scan?').click();
    const secret = ((await page.locator('#kc-totp-secret-key').textContent()) ?? '').trim();
    const { code, counter } = await freshCode(secret, 0);
    await setup.fill(code);
    await page.locator('#saveTOTPBtn, input[type="submit"]').first().click();
    saveTotp(email, secret, counter);
    return;
  }
  const saved = savedTotp(email);
  if (!saved) {
    throw new Error(`No authenticator secret saved for ${email} (${TOTP_FILE})`);
  }
  const { code, counter } = await freshCode(saved.secret, saved.lastUsed);
  await otp.fill(code);
  await page.locator('#kc-login, input[type="submit"]').first().click();
  saveTotp(email, saved.secret, counter);
}

/** A new family: Welcome → Sign up → consent → Keycloak → B1. */
export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue to email' }).click();
  await emailCodeToApp(page, email);
  await expect(page).toHaveURL(/\/setup\/pin$/);
}

/** A returning family on a new device: Welcome → Sign in → Keycloak → C1. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await emailCodeToApp(page, email);
  await expect(page).toHaveURL(/\/who$/);
}

/** Studio staff: S1 → Sign in → Keycloak email code and authenticator code → dashboard. */
export async function signInStaff(page: Page, email: string = ADMIN_EMAIL): Promise<void> {
  await page.goto('/studio/sign-in');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await enterEmailAndCode(page, email);
  await staffSecondFactor(page, email);
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

/** From a kid or C1 screen: Parent mode → P0 PIN → Progress (P1). */
export async function parentMode(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Parent mode' }).click();
  await expect(page).toHaveURL(/\/parent\/pin/);
  await typePin(page);
  await expect(page).toHaveURL(/\/parent\//);
}

/**
 * Waits on P19 until a message with this text arrives (workers and staff finish in the background),
 * leaving and coming back in-app so the list is fetched again without losing the parent PIN.
 */
export async function waitForMessage(page: Page, text: string, timeout = 300_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    await navigateInApp(page, '/parent/messages');
    if (await page.getByText(text, { exact: false }).first().isVisible()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`No message "${text}" within ${timeout / 1000} s`);
    }
    await page.waitForTimeout(5000);
    await navigateInApp(page, '/parent/progress');
  }
}

/** A page image from the book-reader OCR test set (services/book-reader/src/test/resources/pages). */
export function pagePhoto(file: string): { name: string; mimeType: string; buffer: Buffer } {
  const buffer = readFileSync(
    join(__dirname, '../../services/book-reader/src/test/resources/pages', file),
  );
  return { name: file, mimeType: file.endsWith('.png') ? 'image/png' : 'image/jpeg', buffer };
}
