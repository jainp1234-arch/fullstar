import { Page, Request, Route, expect } from '@playwright/test';

/**
 * Stand-ins for Keycloak's OIDC endpoints and the API, so end-to-end tests exercise the real
 * PKCE redirect, token exchange, refresh, interceptors and guards without a server. The real
 * sign-in with an emailed code is e2e/real-sign-in.spec.ts.
 */

export interface FakeChild {
  readonly id: string;
  readonly first_name: string;
  readonly avatar_key: string;
}

export interface FakeOptions {
  /** null: the API answers 404 FAMILY_NOT_FOUND until POST /family/me. */
  readonly children?: readonly FakeChild[] | null;
  readonly pinSet?: boolean;
  /** Studio: 403 FORBIDDEN from /studio/me. */
  readonly staffDenied?: boolean;
}

export interface FakeServer {
  /** Every API request, for header checks. */
  readonly apiRequests: Request[];
  /** Bodies of POST /family/me. */
  readonly createdFamilies: unknown[];
}

const CONSENT = '2026-10-v1';

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An unsigned JWT: keycloak-js only decodes it; the fake API accepts any bearer. */
function jwt(claims: Record<string, unknown>): string {
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(claims)}.sig`;
}

function tokens(nonce: string | null, clientId: string) {
  const now = Math.floor(Date.now() / 1000);
  const common = {
    iss: 'http://fake/auth/realms/fullstar',
    sub: 'user-1',
    azp: clientId,
    iat: now,
  };
  return {
    access_token: jwt({
      ...common,
      exp: now + 300,
      nonce,
      email: 'parent@example.com',
      auth_time: now,
      typ: 'Bearer',
    }),
    refresh_token: jwt({ ...common, exp: now + 30 * 24 * 3600, nonce, typ: 'Offline' }),
    id_token: jwt({ ...common, exp: now + 300, nonce, typ: 'ID' }),
    token_type: 'Bearer',
    expires_in: 300,
  };
}

function envelope(route: Route, status: number, data: unknown, code?: string): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(
      code
        ? { status: 'error', data: null, error: { code, message: code } }
        : { status: 'success', data, error: null },
    ),
  });
}

export async function installFakes(page: Page, options: FakeOptions = {}): Promise<FakeServer> {
  const server: FakeServer = { apiRequests: [], createdFamilies: [] };
  let children = options.children === undefined ? defaultChildren() : options.children;
  let nonce: string | null = null;
  let clientId = 'family-app';

  await page.route(/\/auth\/realms\/fullstar\/protocol\/openid-connect\/auth\?/, async (route) => {
    const url = new URL(route.request().url());
    nonce = url.searchParams.get('nonce');
    clientId = url.searchParams.get('client_id') ?? clientId;
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.hash = new URLSearchParams({
      state: url.searchParams.get('state') ?? '',
      session_state: 'fake-session',
      code: 'fake-code',
    }).toString();
    await route.fulfill({ status: 302, headers: { Location: back.toString() } });
  });

  await page.route(/\/auth\/realms\/fullstar\/protocol\/openid-connect\/token$/, async (route) => {
    const form = new URLSearchParams(route.request().postData() ?? '');
    if (form.get('grant_type') === 'authorization_code') {
      expect(form.get('code_verifier')).toBeTruthy();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tokens(nonce, clientId)),
    });
  });

  await page.route(/\/auth\/realms\/fullstar\/protocol\/openid-connect\/revoke$/, (route) =>
    route.fulfill({ status: 200 }),
  );

  await page.route(
    /\/auth\/realms\/fullstar\/protocol\/openid-connect\/logout\?/,
    async (route) => {
      const back = new URL(route.request().url()).searchParams.get('post_logout_redirect_uri');
      await route.fulfill({ status: 302, headers: { Location: back ?? '/' } });
    },
  );

  await page.route(/\/api\/v1\//, async (route) => {
    const request = route.request();
    server.apiRequests.push(request);
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/public/config') {
      return envelope(route, 200, { consent_version: CONSENT, avatars: [], classes: [] });
    }
    if (!request.headers()['authorization']?.startsWith('Bearer ')) {
      return envelope(route, 401, null, 'UNAUTHENTICATED');
    }
    if (path === '/family/me' && request.method() === 'GET') {
      return children === null
        ? envelope(route, 404, null, 'FAMILY_NOT_FOUND')
        : envelope(route, 200, me(children, options.pinSet ?? true));
    }
    if (path === '/family/me' && request.method() === 'POST') {
      server.createdFamilies.push(request.postDataJSON());
      children = [];
      return envelope(route, 201, me(children, false));
    }
    if (path === '/studio/me') {
      return options.staffDenied
        ? envelope(route, 403, null, 'FORBIDDEN')
        : envelope(route, 200, { id: 's1', display_name: 'Meera', role: 'content_admin' });
    }
    return envelope(route, 200, {});
  });

  return server;
}

function defaultChildren(): FakeChild[] {
  return [
    { id: 'child-asha', first_name: 'Asha', avatar_key: 'rabbit' },
    { id: 'child-ravi', first_name: 'Ravi', avatar_key: 'lion' },
  ];
}

function me(children: readonly FakeChild[], pinSet: boolean) {
  return {
    family: {
      id: 'family-1',
      consent_version: CONSENT,
      daily_limit_minutes: 30,
      sound_enabled: true,
      celebrations_enabled: true,
      pin_set: pinSet,
    },
    children: children.map((child) => ({ ...child, age: 8, class_level: 3, stars_total: 0 })),
  };
}

/** Family app: Welcome → Sign in → (fake Keycloak) → A3 → Who is learning?. */
export async function signInFamily(page: Page, options: FakeOptions = {}): Promise<FakeServer> {
  const server = await installFakes(page, options);
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(who|setup\/pin|sign-up)$/);
  return server;
}

/** Studio: S1 → Sign in → (fake Keycloak) → dashboard. Staff sessions live in memory only. */
export async function signInStudio(page: Page, options: FakeOptions = {}): Promise<FakeServer> {
  const server = await installFakes(page, options);
  await page.goto('sign-in');
  await page.getByRole('button', { name: 'Sign in' }).click();
  return server;
}
