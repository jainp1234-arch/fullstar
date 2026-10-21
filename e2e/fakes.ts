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
  readonly age?: number;
  readonly class_level?: number;
  /** Progress rows the fake keeps, to show that moving class erases them. */
  readonly progress?: number;
}

export interface FakeOptions {
  /** null: the API answers 404 FAMILY_NOT_FOUND until POST /family/me. */
  readonly children?: readonly FakeChild[] | null;
  readonly pinSet?: boolean;
  /** Studio: 403 FORBIDDEN from /studio/me. */
  readonly staffDenied?: boolean;
  /** Studio: the signed-in staff role (default content_admin). */
  readonly staffRole?: FakeStaffRole;
}

export type FakeStaffRole = 'content_admin' | 'super_admin';

export interface FakeStaffMember {
  id: string;
  display_name: string;
  role: FakeStaffRole;
  active: boolean;
  created_at: string;
}

export interface FakeServer {
  /** Every API request, for header checks. */
  readonly apiRequests: Request[];
  /** Bodies of POST /family/me. */
  readonly createdFamilies: unknown[];
  /** The family's children and settings as the fake API holds them now. */
  readonly family: {
    children: FakeChild[];
    dailyLimitMinutes: number;
    deletionRequests: number;
    deletionRequestedAt: string | null;
  };
  /** Studio staff list as the fake API holds it (s1 is the signed-in member). */
  readonly staff: FakeStaffMember[];
}

const CONSENT = '2026-10-v1';
/** The parent PIN of the default family. */
export const FAKE_PIN = '1234';
const GRANT = 'fake-parent-grant';
/** Schema §8.2: 5 wrong PINs lock parent mode for 1 minute. */
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_S = 60;

const CONFIG = {
  consent_version: CONSENT,
  avatars: ['cat', 'dog', 'lion', 'panda', 'rabbit', 'tiger'],
  classes: [1, 2, 3, 4, 5].map((classLevel) => ({
    class_level: classLevel,
    subjects: [
      { id: 1, code: 'english', name: 'English' },
      { id: 2, code: 'hindi', name: 'Hindi' },
      { id: 3, code: 'maths', name: 'Maths' },
      { id: 4, code: 'evs', name: 'EVS' },
    ],
  })),
  upload_limits: {
    pdf_max_bytes: 52428800,
    pdf_max_pages: 300,
    photo_max_bytes: 10485760,
    photos_per_upload: 50,
  },
  time_limits: { options_minutes: [20, 30, 45, 60], default_minutes: 30 },
  privacy_notice_url: 'https://fullstar.example/privacy',
};

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

function envelope(
  route: Route,
  status: number,
  data: unknown,
  code?: string,
  extra: { fields?: Record<string, string>; retry_after_s?: number } = {},
): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(
      code
        ? { status: 'error', data: null, error: { code, message: code, ...extra } }
        : { status: 'success', data, error: null },
    ),
  });
}

export async function installFakes(page: Page, options: FakeOptions = {}): Promise<FakeServer> {
  const initial = options.children === undefined ? defaultChildren() : options.children;
  const server: FakeServer = {
    apiRequests: [],
    createdFamilies: [],
    family: {
      children: [...(initial ?? [])],
      dailyLimitMinutes: 30,
      deletionRequests: 0,
      deletionRequestedAt: null,
    },
    staff: [
      {
        id: 's1',
        display_name: 'Meera',
        role: options.staffRole ?? 'content_admin',
        active: true,
        created_at: '2026-10-01T09:00:00Z',
      },
    ],
  };
  let nextStaff = 2;
  let hasFamily = initial !== null;
  let pin: string | null = (options.pinSet ?? true) ? FAKE_PIN : null;
  let pinFailures = 0;
  let lockedUntil = 0;
  let nextChild = 1;
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
    const method = request.method();
    if (path === '/public/config') {
      return envelope(route, 200, CONFIG);
    }
    if (!request.headers()['authorization']?.startsWith('Bearer ')) {
      return envelope(route, 401, null, 'UNAUTHENTICATED');
    }
    if (path.startsWith('/studio/')) {
      return studio(route, server, path, method, options, () => `s${nextStaff++}`);
    }
    if (path === '/family/me' && method === 'POST') {
      server.createdFamilies.push(request.postDataJSON());
      hasFamily = true;
      pin = null;
      return envelope(route, 201, me(server, pin !== null));
    }
    if (path.startsWith('/family/') && !hasFamily) {
      return envelope(route, 404, null, 'FAMILY_NOT_FOUND');
    }
    if (path === '/family/me') {
      return envelope(route, 200, me(server, pin !== null));
    }
    const body = (method === 'GET' ? {} : (request.postDataJSON() ?? {})) as Record<
      string,
      unknown
    >;
    if (path === '/family/pin' && method === 'POST') {
      if (pin !== null) {
        return envelope(route, 409, null, 'CONFLICT');
      }
      pin = String(body['pin']);
      return envelope(route, 201, { pin_set: true, parent_grant: GRANT, expires_in: 900 });
    }
    if (path === '/family/pin' && method === 'PUT') {
      pin = String(body['pin']);
      pinFailures = 0;
      lockedUntil = 0;
      return envelope(route, 200, { pin_set: true });
    }
    if (path === '/family/pin/verify') {
      const now = Date.now();
      if (lockedUntil > now) {
        return envelope(route, 423, null, 'PIN_LOCKED', {
          retry_after_s: Math.ceil((lockedUntil - now) / 1000),
        });
      }
      if (body['pin'] === pin) {
        pinFailures = 0;
        return envelope(route, 200, { parent_grant: GRANT, expires_in: 900 });
      }
      pinFailures += 1;
      if (pinFailures >= MAX_PIN_FAILURES) {
        pinFailures = 0;
        lockedUntil = now + PIN_LOCK_S * 1000;
        return envelope(route, 423, null, 'PIN_LOCKED', { retry_after_s: PIN_LOCK_S });
      }
      return envelope(route, 401, null, 'PIN_REQUIRED', { fields: { pin: 'WRONG' } });
    }
    if (path.startsWith('/family/parent/')) {
      const firstChild =
        path === '/family/parent/children' &&
        method === 'POST' &&
        server.family.children.length === 0;
      if (request.headers()['x-parent-grant'] !== GRANT && !firstChild) {
        return envelope(route, 401, null, 'PIN_REQUIRED');
      }
    }
    if (path === '/family/parent/children' && method === 'POST') {
      if (server.family.children.length >= 2) {
        return envelope(route, 409, null, 'MAX_CHILDREN');
      }
      const child: FakeChild = {
        id: `child-new-${nextChild++}`,
        first_name: String(body['first_name']),
        avatar_key: String(body['avatar_key']),
        age: Number(body['age']),
        class_level: Number(body['class_level']),
      };
      server.family.children.push(child);
      return envelope(route, 201, wireChild(child));
    }
    const childPath = /^\/family\/parent\/children\/([^/]+)(\/move-to-next-class)?$/.exec(path);
    if (childPath) {
      const index = server.family.children.findIndex((child) => child.id === childPath[1]);
      const child = server.family.children[index];
      if (!child) {
        return envelope(route, 404, null, 'NOT_FOUND');
      }
      if (childPath[2] && method === 'POST') {
        const classLevel = child.class_level ?? 3;
        if (classLevel >= 5) {
          return envelope(route, 409, null, 'MAX_CLASS');
        }
        server.family.children[index] = { ...child, class_level: classLevel + 1, progress: 0 };
      } else if (method === 'PATCH') {
        server.family.children[index] = {
          ...child,
          ...(typeof body['first_name'] === 'string' ? { first_name: body['first_name'] } : {}),
          ...(typeof body['age'] === 'number' ? { age: body['age'] } : {}),
          ...(typeof body['avatar_key'] === 'string' ? { avatar_key: body['avatar_key'] } : {}),
        };
      } else if (method === 'DELETE') {
        server.family.children.splice(index, 1);
        return envelope(route, 200, { id: child.id });
      }
      return envelope(route, 200, wireChild(server.family.children[index]));
    }
    if (path === '/family/parent/deletion-request' && method === 'POST') {
      const first = server.family.deletionRequestedAt === null;
      if (first) {
        server.family.deletionRequests += 1;
        server.family.deletionRequestedAt = new Date().toISOString();
      }
      const requestedAt = server.family.deletionRequestedAt ?? '';
      const dueBy = new Date(Date.parse(requestedAt) + 30 * 24 * 3600 * 1000).toISOString();
      return envelope(route, first ? 201 : 200, { requested_at: requestedAt, due_by: dueBy });
    }
    if (path === '/family/parent/settings') {
      if (typeof body['daily_limit_minutes'] === 'number') {
        server.family.dailyLimitMinutes = body['daily_limit_minutes'];
      }
      return envelope(route, 200, settings(server));
    }
    return envelope(route, 200, {});
  });

  return server;
}

/** Opens a parent screen: the guard sends it to P0, the PIN brings it back. */
export async function unlockParent(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/parent\/pin\?next=/);
  await enterPin(page);
  await expect(page).toHaveURL((url) => url.pathname === path);
}

/** Unlocks parent mode on P0 by typing the PIN on the pad. */
export async function enterPin(page: Page, value: string = FAKE_PIN): Promise<void> {
  // After a wrong PIN the pad shakes and ignores keys until it has cleared
  await expect(page.getByRole('status').filter({ hasText: 'digits entered' })).toHaveText(
    /^0 of 4/,
  );
  for (const digit of value) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
}

function defaultChildren(): FakeChild[] {
  return [
    { id: 'child-asha', first_name: 'Asha', avatar_key: 'rabbit' },
    { id: 'child-ravi', first_name: 'Ravi', avatar_key: 'lion' },
  ];
}

function wireChild(child: FakeChild) {
  return {
    id: child.id,
    first_name: child.first_name,
    avatar_key: child.avatar_key,
    age: child.age ?? 8,
    class_level: child.class_level ?? 3,
    stars_total: child.progress ?? 0,
  };
}

function settings(server: FakeServer) {
  return {
    daily_limit_minutes: server.family.dailyLimitMinutes,
    sound_enabled: true,
    celebrations_enabled: true,
  };
}

function me(server: FakeServer, pinSet: boolean) {
  return {
    family: {
      id: 'family-1',
      consent_version: CONSENT,
      ...settings(server),
      pin_set: pinSet,
      deletion_requested_at: server.family.deletionRequestedAt,
    },
    children: server.family.children.map(wireChild),
  };
}

/** Family app: Welcome → Sign in → (fake Keycloak) → A3 → Who is learning?. */
export async function signInFamily(page: Page, options: FakeOptions = {}): Promise<FakeServer> {
  const server = await installFakes(page, options);
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(who|setup\/pin|setup\/child|sign-up)$/);
  return server;
}

/** Studio: S1 → Sign in → (fake Keycloak) → dashboard. Staff sessions live in memory only. */
export async function signInStudio(page: Page, options: FakeOptions = {}): Promise<FakeServer> {
  const server = await installFakes(page, options);
  await page.goto('sign-in');
  await page.getByRole('button', { name: 'Sign in' }).click();
  return server;
}

/** The /studio/** endpoints of Schema §11 that exist so far (Plan 4.1). */
function studio(
  route: Route,
  server: FakeServer,
  path: string,
  method: string,
  options: FakeOptions,
  newId: () => string,
): Promise<void> {
  if (options.staffDenied) {
    return envelope(route, 403, null, 'FORBIDDEN');
  }
  const me = server.staff[0];
  if (path === '/studio/me') {
    return envelope(route, 200, { id: me.id, display_name: me.display_name, role: me.role });
  }
  if (path === '/studio/dashboard') {
    return envelope(route, 200, {
      uploads_waiting: 3,
      drafts: 1,
      recently_published: 4,
      open_reports: 2,
      open_tickets: 1,
    });
  }
  if (path.startsWith('/studio/staff')) {
    if (me.role !== 'super_admin') {
      return envelope(route, 403, null, 'FORBIDDEN');
    }
    const body = (method === 'GET' ? {} : (route.request().postDataJSON() ?? {})) as Record<
      string,
      unknown
    >;
    if (path === '/studio/staff' && method === 'GET') {
      return envelope(route, 200, server.staff);
    }
    if (path === '/studio/staff' && method === 'POST') {
      const email = String(body['email'] ?? '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return envelope(route, 400, null, 'VALIDATION_FAILED', {
          fields: { email: 'INVALID_FORMAT' },
        });
      }
      if (email === 'meera@example.com') {
        return envelope(route, 409, null, 'CONFLICT');
      }
      const member: FakeStaffMember = {
        id: newId(),
        display_name: String(body['display_name']),
        role: body['role'] as FakeStaffRole,
        active: true,
        created_at: new Date().toISOString(),
      };
      server.staff.push(member);
      return envelope(route, 201, member);
    }
    const member = server.staff.find((row) => path === `/studio/staff/${row.id}`);
    if (method === 'PATCH' && member) {
      if (member.id === me.id && ('role' in body || 'active' in body)) {
        return envelope(route, 409, null, 'CONFLICT');
      }
      Object.assign(member, body);
      return envelope(route, 200, member);
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}
