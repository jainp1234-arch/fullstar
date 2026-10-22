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
  /** Studio: FEATURE_AI_DRAFTS on (default off, as in trial). */
  readonly aiDrafts?: boolean;
  /** Studio: FEATURE_AI_CHECK on (default off, as in trial). */
  readonly aiCheck?: boolean;
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
    /** Plan 8.2: the sample lesson has narration audio (voice-maker has run). */
    lessonNarrated: boolean;
    deletionRequests: number;
    deletionRequestedAt: string | null;
    /** Books, chapters and uploads (Plan 5.1). */
    books: FakeBook[];
    /** Confirmed chapter splits (P6), as sent. */
    splits: { number: number; title: string; start_page: number }[][];
    /** Files PUT to the fake storage. */
    stored: string[];
    /** P19 messages (Plan 5.5). */
    messages: FakeMessage[];
    /** P8a answers by content item, and the reports they opened. */
    previews: Record<string, string>;
    reports: { content_item_id: string; reason: string; note: string | null }[];
    /** Bodies of POST /family/kid/sync and the attempts kept, by id (Plan 6.2). */
    syncs: { childId: string; body: Record<string, unknown[]> }[];
    attempts: Record<string, { stars: number; completed_at: string | null }>;
    /** Question ids in the child's open mistakes (Plan 7.1). */
    mistakes: string[];
    /** Worksheets (Plan 7.2) and how often each PDF was asked for. */
    worksheets: FakeWorksheet[];
    /** Ids of books removed by Replace book (P9, Plan 7.4). */
    replaced: string[];
  };
  /** Studio staff list as the fake API holds it (s1 is the signed-in member). */
  readonly staff: FakeStaffMember[];
  /** Studio topics, content items and versions (Plan 4.2). */
  readonly content: FakeContent;
  /** S8 queue and prepared books (Plan 5.5); task "sample" is the S9 route sample. */
  readonly prep: FakePrep;
  /** P18/S7 problem reports and P16/S12 tickets (Plan 7.3); "r1" and "tk1" are samples. */
  readonly support: FakeSupport;
  /** K12–K14 reading tests and P3 history (Plan 8.3). */
  readonly reading: FakeReading;
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
      lessonNarrated: false,
      deletionRequests: 0,
      deletionRequestedAt: null,
      books: [],
      splits: [],
      messages: [],
      previews: {},
      reports: [],
      syncs: [],
      attempts: {},
      mistakes: [],
      worksheets: [],
      replaced: [],
      stored: [],
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
    content: sampleContent(),
    prep: samplePrep(),
    support: sampleSupport(),
    reading: sampleReading(),
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

  // Signed storage URLs of the fake API (Plan 5.1): every PUT is accepted and recorded
  await page.route(/\/fake-storage\//, async (route) => {
    server.family.stored.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200 });
  });

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
    if (
      path === '/family/kid/reading' ||
      path.startsWith('/family/kid/reading-tests') ||
      /^\/family\/parent\/children\/[^/]+\/reading-tests$/.test(path)
    ) {
      return familyReading(route, server, path, method, body);
    }
    if (path.startsWith('/family/kid/')) {
      return familyKid(route, server, path);
    }
    const progress = /^\/family\/parent\/children\/([^/]+)\/(week|subjects\/(\d+))$/.exec(path);
    if (progress && method === 'GET') {
      // P1 and P2 (Plan 6.4): Asha has a week of activity; others have none yet
      const active = progress[1] === 'child-asha';
      if (!server.family.children.some((c) => c.id === progress[1])) {
        return envelope(route, 404, null, 'NOT_FOUND');
      }
      if (progress[2] === 'week') {
        return envelope(route, 200, {
          start: '2026-10-19',
          minutes: active ? 95 : 0,
          active_days: active ? 4 : 0,
          chapters_done: active ? 2 : 0,
          worksheets_done: 0,
          areas: active
            ? [{ topic_id: 't-water', name: 'Saving water', subject: 'evs', score: 2 }]
            : [],
          subjects: [
            {
              subject_id: 1,
              code: 'english',
              name: 'English',
              chapters_done: 0,
              chapters_total: 0,
              lessons_done: active ? 3 : 0,
            },
            {
              subject_id: 2,
              code: 'hindi',
              name: 'Hindi',
              chapters_done: 0,
              chapters_total: 0,
              lessons_done: 0,
            },
            {
              subject_id: 3,
              code: 'maths',
              name: 'Maths',
              chapters_done: 0,
              chapters_total: 0,
              lessons_done: 0,
            },
            {
              subject_id: 4,
              code: 'evs',
              name: 'EVS',
              chapters_done: active ? 2 : 0,
              chapters_total: active ? 5 : 0,
              lessons_done: active ? 2 : 0,
            },
          ],
          any_activity: active,
        });
      }
      return envelope(route, 200, {
        subject_id: Number(progress[3]),
        code: 'evs',
        name: 'EVS',
        chapters: active
          ? [
              { id: 'ch-1', number: 1, title: 'Plants', done: true },
              { id: 'ch-2', number: 2, title: 'Water', done: false },
            ]
          : [],
        accuracy: active
          ? [{ topic_id: 't-water', name: 'Saving water', correct: 7, answered: 10 }]
          : [],
        weak_spots: [],
      });
    }
    if (path.startsWith('/family/parent/worksheets')) {
      return familyWorksheets(route, server, path, method, body);
    }
    if (
      path.startsWith('/family/parent/problem-reports') ||
      path.startsWith('/family/parent/support-tickets')
    ) {
      return familySupport(route, server, path, method, body);
    }
    if (
      path.startsWith('/family/parent/messages') ||
      path.startsWith('/family/parent/lessons/') ||
      /^\/family\/parent\/chapters\/[^/]+\/lessons$/.test(path)
    ) {
      return familyMessages(route, server, path, method, body);
    }
    if (
      path.startsWith('/family/parent/books') ||
      path.startsWith('/family/parent/uploads') ||
      path.startsWith('/family/parent/chapters') ||
      path.startsWith('/family/parent/pages')
    ) {
      return familyBooks(route, server, path, method, body);
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
    return envelope(route, 200, {
      id: me.id,
      display_name: me.display_name,
      role: me.role,
      features: { ai_drafts: !!options.aiDrafts, ai_check: !!options.aiCheck },
    });
  }
  if (path.startsWith('/studio/ai/')) {
    return studioDrafts(route, path, !!options.aiDrafts);
  }
  if (
    path.startsWith('/studio/prep-tasks') ||
    path.startsWith('/studio/catalog-') ||
    path.startsWith('/studio/family-chapters/')
  ) {
    return studioPrep(route, server, path, method, newId);
  }
  if (path.startsWith('/studio/problem-reports') || path.startsWith('/studio/support-tickets')) {
    return studioSupport(route, server, path, method);
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
  const checked = studioChecks(route, server.content, path, method, newId, !!options.aiCheck);
  return checked ?? studioContent(route, server.content, path, method, newId);
}

export interface FakeTopic {
  id: string;
  class_level: number;
  subject: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  archived: boolean;
  item_count: number;
}

export interface FakeVersion {
  id: string;
  item_id: string;
  version_no: number;
  title: string;
  body: unknown;
  solution: unknown;
  duration_seconds: number | null;
  created_at: string;
  created_by_name: string;
}

export interface FakeItem {
  id: string;
  kind: string;
  question_type: string | null;
  class_level: number;
  subject: string;
  topic_id: string;
  difficulty: number;
  lang: string;
  status: string;
  current_version_id: string;
  published_version_id: string | null;
  updated_at: string;
  versions: FakeVersion[];
  /** Content checks of this item's versions, newest last (Plan 4.4). */
  checks?: FakeCheck[];
  /** Content of a prepared chapter (Plan 5.5). */
  catalog_chapter_id?: string | null;
}

export interface FakeFlag {
  id: string;
  severity: string;
  category: string;
  location: string;
  reason: string;
  resolution: string;
  resolution_note: string | null;
  resolved_at: string | null;
}

export interface FakeCheck {
  id: string;
  version_id: string;
  status: string;
  model: string;
  flags: FakeFlag[];
}

export interface FakeContent {
  topics: FakeTopic[];
  items: FakeItem[];
}

const SAMPLE_SCENES = [
  {
    id: 's1',
    duration_ms: 8000,
    text: 'A bird builds a nest.',
    visual: { illustration: 'subject-evs', animation: 'fade-up' },
  },
  { id: 's2', duration_ms: 6000, text: 'It uses twigs and grass.', visual: null },
];

/** Class 3 EVS: Water with a sub-topic, and one lesson ("sample", the S5 route sample) in 2 versions. */
function sampleContent(): FakeContent {
  const topic = (id: string, name: string, parent: string | null): FakeTopic => ({
    id,
    class_level: 3,
    subject: 'evs',
    parent_id: parent,
    name,
    sort_order: 0,
    archived: false,
    item_count: id === 't1' ? 1 : 0,
  });
  const version = (no: number, text: string): FakeVersion => ({
    id: `v${no}`,
    item_id: 'sample',
    version_no: no,
    title: no === 1 ? 'Birds' : 'Birds and nests',
    body: { scenes: [{ ...SAMPLE_SCENES[0], text }, SAMPLE_SCENES[1]] },
    solution: null,
    duration_seconds: 14,
    created_at: `2026-10-0${no}T09:00:00Z`,
    created_by_name: 'Meera',
  });
  return {
    topics: [topic('t1', 'Water', null), topic('t2', 'Saving water', 't1')],
    items: [
      {
        id: 'sample',
        kind: 'lesson',
        question_type: null,
        class_level: 3,
        subject: 'evs',
        topic_id: 't1',
        difficulty: 2,
        lang: 'en',
        status: 'draft',
        current_version_id: 'v2',
        published_version_id: null,
        updated_at: '2026-10-02T09:00:00Z',
        versions: [version(1, 'A bird makes a nest.'), version(2, 'A bird builds a nest.')],
      },
    ],
  };
}

function summary(item: FakeItem) {
  const { versions, ...rest } = item;
  const current = versions.find((v) => v.id === item.current_version_id);
  return {
    ...rest,
    catalog_chapter_id: item.catalog_chapter_id ?? null,
    title: current?.title ?? '',
    version_no: current?.version_no ?? 0,
  };
}

function versionView(item: FakeItem, version: FakeVersion) {
  const current = version.id === item.current_version_id;
  return {
    ...version,
    current,
    published: version.id === item.published_version_id,
    read_only: !current,
  };
}

function detail(item: FakeItem) {
  const current = item.versions.find((v) => v.id === item.current_version_id);
  return {
    item: summary(item),
    current_version: current ? versionView(item, current) : null,
    latest_check: latestCheck(item),
    versions: [...item.versions].reverse().map((v) => ({
      id: v.id,
      version_no: v.version_no,
      title: v.title,
      created_at: v.created_at,
      created_by_name: v.created_by_name,
      current: v.id === item.current_version_id,
      published: v.id === item.published_version_id,
    })),
  };
}

/** Field errors the real API would give for the cases the e2e tests use. */
function contentErrors(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!String(body['title'] ?? '').trim()) {
    errors['title'] = 'REQUIRED';
  }
  const lesson = body['body'] as { scenes?: { text?: string | null; quiz?: unknown }[] } | null;
  lesson?.scenes?.forEach((scene, i) => {
    if (!scene.quiz && !scene.text?.trim()) {
      errors[`body.scenes[${i}].text`] = 'REQUIRED';
    }
  });
  return errors;
}

function newVersion(item: FakeItem, body: Record<string, unknown>, now: string): FakeVersion {
  const no = item.versions.length + 1;
  return {
    id: `${item.id}-v${no}`,
    item_id: item.id,
    version_no: no,
    title: String(body['title']),
    body: body['body'],
    solution: body['solution'] ?? null,
    duration_seconds: null,
    created_at: now,
    created_by_name: 'Meera',
  };
}

/** Topics, content items and versions of Schema §11 (Plan 4.2), kept in memory. */
function studioContent(
  route: Route,
  content: FakeContent,
  path: string,
  method: string,
  newId: () => string,
): Promise<void> {
  const url = new URL(route.request().url());
  const body = (method === 'GET' ? {} : (route.request().postDataJSON() ?? {})) as Record<
    string,
    unknown
  >;
  const now = new Date().toISOString();
  if (path === '/studio/topics' && method === 'GET') {
    const classLevel = Number(url.searchParams.get('class'));
    const subject = url.searchParams.get('subject');
    const topics = content.topics.filter(
      (t) => t.class_level === classLevel && t.subject === subject,
    );
    return envelope(route, 200, topics);
  }
  if (path === '/studio/topics' && method === 'POST') {
    const parent = (body['parent_id'] as string | null | undefined) ?? null;
    if (content.topics.some((t) => t.parent_id === parent && t.name === body['name'])) {
      return envelope(route, 409, null, 'CONFLICT');
    }
    const topic: FakeTopic = {
      id: `t-${newId()}`,
      class_level: Number(body['class_level']),
      subject: String(body['subject']),
      parent_id: parent,
      name: String(body['name']),
      sort_order: 0,
      archived: false,
      item_count: 0,
    };
    content.topics.push(topic);
    return envelope(route, 201, topic);
  }
  const topic = content.topics.find((t) => path === `/studio/topics/${t.id}`);
  if (topic && method === 'PATCH') {
    Object.assign(topic, body);
    return envelope(route, 200, topic);
  }
  if (path === '/studio/content-items' && method === 'GET') {
    const topicId = url.searchParams.get('topic_id');
    const status = url.searchParams.get('status');
    const catalogChapter = url.searchParams.get('catalog_chapter_id');
    const items = content.items
      .filter(
        (i) =>
          (topicId ? i.topic_id === topicId : true) &&
          (status ? i.status === status : true) &&
          (catalogChapter ? i.catalog_chapter_id === catalogChapter : true),
      )
      .map(summary);
    return envelope(route, 200, { items, next_cursor: null });
  }
  if (path === '/studio/content-items' && method === 'POST') {
    const errors = contentErrors(body);
    if (Object.keys(errors).length) {
      return envelope(route, 400, null, 'VALIDATION_FAILED', { fields: errors });
    }
    const item: FakeItem = {
      id: `c-${newId()}`,
      kind: String(body['kind']),
      question_type: (body['question_type'] as string | undefined) ?? null,
      class_level: Number(body['class_level']),
      subject: String(body['subject']),
      topic_id: String(body['topic_id']),
      difficulty: Number(body['difficulty']),
      lang: String(body['lang']),
      status: 'draft',
      current_version_id: '',
      published_version_id: null,
      updated_at: now,
      versions: [],
      catalog_chapter_id: (body['catalog_chapter_id'] as string | undefined) ?? null,
    };
    const first = newVersion(item, body, now);
    item.versions.push(first);
    item.current_version_id = first.id;
    content.items.push(item);
    const parent = content.topics.find((t) => t.id === item.topic_id);
    if (parent) {
      parent.item_count++;
    }
    return envelope(route, 201, detail(item));
  }
  for (const item of content.items) {
    if (path === `/studio/content-items/${item.id}` && method === 'GET') {
      return envelope(route, 200, detail(item));
    }
    if (path === `/studio/content-items/${item.id}/versions` && method === 'POST') {
      if (body['base_version_id'] !== item.current_version_id) {
        return envelope(route, 409, null, 'CONFLICT');
      }
      const errors = contentErrors(body);
      if (Object.keys(errors).length) {
        return envelope(route, 400, null, 'VALIDATION_FAILED', { fields: errors });
      }
      const version = newVersion(item, body, now);
      item.versions.push(version);
      item.current_version_id = version.id;
      item.updated_at = now;
      return envelope(route, 201, detail(item));
    }
    const version = item.versions.find((v) => path === `/studio/content-versions/${v.id}`);
    if (version && method === 'GET') {
      return envelope(route, 200, versionView(item, version));
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}

/** The drafted lesson the fake "Claude" returns when AI drafts are on. */
export const FAKE_CLAUDE_LESSON = {
  title: 'Clouds',
  difficulty: 1,
  body: {
    scenes: [
      { id: 's1', duration_ms: 6000, text: 'Clouds are tiny drops of water.', visual: null },
      { id: 's2', duration_ms: 5000, text: 'Big grey clouds bring rain.', visual: null },
    ],
  },
};

function draftItem(kind: string, node: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  if (!String(node['title'] ?? '').trim()) {
    errors['title'] = 'REQUIRED';
  }
  if (!node['body']) {
    errors['body'] = 'REQUIRED';
  }
  return {
    kind,
    question_type: (node['question_type'] as string | undefined) ?? null,
    title: String(node['title'] ?? ''),
    difficulty: Number(node['difficulty'] ?? 2),
    body: node['body'] ?? null,
    solution: node['solution'] ?? null,
    errors,
  };
}

/** POST /studio/ai/drafts and /draft-prompt (Plan 4.3): pasted drafts are read; Claude only when on. */
function studioDrafts(route: Route, path: string, aiDrafts: boolean): Promise<void> {
  const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
  const type = String(body['type']);
  if (path === '/studio/ai/draft-prompt') {
    return envelope(route, 200, {
      system: 'You write learning content for FullStar.',
      user: `Write a ${type} for Class ${String(body['class_level'])}.`,
    });
  }
  const pasted = body['pasted'] as string | undefined;
  let json: unknown = FAKE_CLAUDE_LESSON;
  if (pasted) {
    const start = pasted.indexOf('{');
    const end = pasted.lastIndexOf('}');
    try {
      json = JSON.parse(pasted.slice(start, end + 1));
    } catch {
      return envelope(route, 400, null, 'VALIDATION_FAILED', {
        fields: { pasted: 'INVALID_FORMAT' },
      });
    }
  } else if (!aiDrafts) {
    return envelope(route, 503, null, 'FEATURE_DISABLED');
  }
  const node = json as Record<string, unknown>;
  const items =
    type === 'question_bank'
      ? ((node['questions'] as Record<string, unknown>[] | undefined) ?? []).map((q) =>
          draftItem('question', q),
        )
      : [draftItem(type, node)];
  return envelope(route, 200, { type, source: pasted ? 'pasted' : 'claude', items });
}

function checkView(item: FakeItem, check: FakeCheck) {
  const critical = check.flags.filter((f) => f.severity === 'critical').length;
  const open = check.flags.filter((f) => f.resolution === 'open').length;
  const version = item.versions.find((v) => v.id === check.version_id);
  return {
    id: check.id,
    version_id: check.version_id,
    item_id: item.id,
    version_no: version?.version_no ?? 0,
    status: check.status,
    model: check.model,
    critical_count: critical,
    warning_count: check.flags.length - critical,
    open_flags: open,
    publishable: check.status === 'passed' && open === 0,
    error_message: null,
    started_at: '2026-10-21T09:00:00Z',
    finished_at: check.status === 'running' ? null : '2026-10-21T09:00:01Z',
    flags: check.flags,
  };
}

function latestCheck(item: FakeItem) {
  const checks = (item.checks ?? []).filter((c) => c.version_id === item.current_version_id);
  const last = checks[checks.length - 1];
  if (!last) {
    return null;
  }
  const view: Partial<ReturnType<typeof checkView>> = checkView(item, last);
  delete view.flags;
  return view;
}

/** Content checks, flags and publishing (Plan 4.4); null when the path is not one of them. */
function studioChecks(
  route: Route,
  content: FakeContent,
  path: string,
  method: string,
  newId: () => string,
  aiCheck: boolean,
): Promise<void> | null {
  const body = (method === 'GET' ? {} : (route.request().postDataJSON() ?? {})) as Record<
    string,
    unknown
  >;
  for (const item of content.items) {
    const checks = (item.checks ??= []);
    for (const version of item.versions) {
      const base = `/studio/content-versions/${version.id}`;
      if (path === `${base}/manual-check` && method === 'POST') {
        if (version.id !== item.current_version_id) {
          return envelope(route, 409, null, 'CONFLICT');
        }
        const checklist = (body['checklist'] ?? {}) as Record<string, boolean>;
        const given = (body['flags'] ?? []) as Record<string, string>[];
        const errors: Record<string, string> = {};
        given.forEach((flag, i) => {
          if (!flag['location']) errors[`flags[${i}].location`] = 'REQUIRED';
          if (!flag['reason']) errors[`flags[${i}].reason`] = 'REQUIRED';
        });
        if (Object.keys(errors).length) {
          return envelope(route, 400, null, 'VALIDATION_FAILED', { fields: errors });
        }
        const flags: FakeFlag[] = given.map((flag) => ({
          id: `f-${newId()}`,
          severity: flag['severity'],
          category: flag['category'],
          location: flag['location'],
          reason: flag['reason'],
          resolution: 'open',
          resolution_note: null,
          resolved_at: null,
        }));
        const allTrue =
          Object.values(checklist).length === 7 && Object.values(checklist).every(Boolean);
        const check: FakeCheck = {
          id: `k-${newId()}`,
          version_id: version.id,
          status: allTrue && !flags.some((f) => f.severity === 'critical') ? 'passed' : 'failed',
          model: 'manual',
          flags,
        };
        checks.push(check);
        if (item.status === 'draft') {
          item.status = 'in_check';
        }
        return envelope(route, 201, checkView(item, check));
      }
      if (path === `${base}/checks` && method === 'POST') {
        if (!aiCheck) {
          return envelope(route, 503, null, 'FEATURE_DISABLED');
        }
        const check: FakeCheck = {
          id: `k-${newId()}`,
          version_id: version.id,
          status: 'passed',
          model: 'claude-sonnet-5-5',
          flags: [
            {
              id: `f-${newId()}`,
              severity: 'warning',
              category: 'difficulty',
              location: 'body.scenes[0].text',
              reason: 'A little easy for Class 3.',
              resolution: 'open',
              resolution_note: null,
              resolved_at: null,
            },
          ],
        };
        checks.push(check);
        return envelope(route, 202, { ...checkView(item, check), status: 'running', flags: [] });
      }
    }
    for (const check of checks) {
      if (path === `/studio/content-checks/${check.id}` && method === 'GET') {
        return envelope(route, 200, checkView(item, check));
      }
      const flag = check.flags.find((f) => path === `/studio/content-check-flags/${f.id}`);
      if (flag && method === 'PATCH') {
        if (flag.severity !== 'warning') {
          return envelope(route, 409, null, 'CONFLICT');
        }
        flag.resolution = 'accepted';
        flag.resolution_note = String(body['note']);
        flag.resolved_at = new Date().toISOString();
        return envelope(route, 200, checkView(item, check));
      }
    }
    if (path === `/studio/content-items/${item.id}/publish` && method === 'POST') {
      if (!latestCheck(item)?.publishable) {
        return envelope(route, 409, null, 'CHECK_NOT_PASSED');
      }
      item.status = 'published';
      item.published_version_id = item.current_version_id;
      return envelope(route, 200, detail(item));
    }
    if (path === `/studio/content-items/${item.id}/unpublish` && method === 'POST') {
      item.status = 'archived';
      return envelope(route, 200, detail(item));
    }
  }
  return null;
}

export interface FakeChapter {
  id: string;
  number: number;
  title: string;
  status: string;
  page_count: number;
  unclear_pages: number;
  /** Read pages (Plan 5.3); absent means none yet. */
  pages?: FakePage[];
  /** The prepared chapter it is linked to (Plan 5.5). */
  catalog_chapter_id?: string;
}

export interface FakePage {
  id: string;
  page_no: number;
  quality: 'ok' | 'unclear' | 'retaken';
}

/** A 1×1 grey PNG for page thumbnails. */
const PAGE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGO4BwAA0gDQjvrmxgAAAABJRU5ErkJggg==';

export interface FakeUpload {
  id: string;
  family_book_id: string;
  family_chapter_id: string | null;
  source: string;
  status: string;
  reject_reason: string | null;
  file_count: number;
  /** File names, to fake the content check: a name with "not-a-photo" is the wrong type. */
  names: string[];
  retake_page_id?: string;
}

export interface FakeBook {
  id: string;
  subject_id: number;
  upload_mode: string;
  status: string;
  class_level: number;
  child_ids: string[];
  chapters: FakeChapter[];
  uploads: FakeUpload[];
}

const SUBJECTS = [
  { id: 1, code: 'english', name: 'English' },
  { id: 2, code: 'hindi', name: 'Hindi' },
  { id: 3, code: 'maths', name: 'Maths' },
  { id: 4, code: 'evs', name: 'EVS' },
];

function chapterView(chapter: FakeChapter) {
  const { pages, ...rest } = chapter;
  return { ...rest, unclear_pages: (pages ?? []).filter((p) => p.quality === 'unclear').length };
}

function bookView(book: FakeBook) {
  const { uploads, chapters, ...rest } = book;
  const latest = uploads[uploads.length - 1];
  return {
    ...rest,
    chapters: chapters.map(chapterView),
    latest_upload: latest
      ? {
          id: latest.id,
          source: latest.source,
          status: latest.status,
          reject_reason: latest.reject_reason,
          file_count: latest.file_count,
        }
      : null,
  };
}

function uploadView(upload: FakeUpload, files: unknown[] = []) {
  const view: Partial<FakeUpload> = { ...upload };
  delete view.names;
  return { ...view, files };
}

let fakeIds = 0;

/** Books, chapters and uploads of Schema §11 (Plan 5.1), kept in memory with the limits. */
function familyBooks(
  route: Route,
  server: FakeServer,
  path: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  const books = server.family.books;
  const url = new URL(route.request().url());
  const next = (prefix: string) => `${prefix}-${++fakeIds}`;
  if (path === '/family/parent/books' && method === 'GET') {
    const childId = url.searchParams.get('child_id');
    const child = server.family.children.find((c) => c.id === childId);
    if (!child) {
      return envelope(route, 400, null, 'VALIDATION_FAILED', { fields: { child_id: 'INVALID' } });
    }
    return envelope(
      route,
      200,
      SUBJECTS.map((s) => {
        const book = books.find((b) => b.subject_id === s.id && b.child_ids.includes(child.id));
        return {
          subject_id: s.id,
          subject: s.code,
          subject_name: s.name,
          book: book ? bookView(book) : null,
        };
      }),
    );
  }
  if (path === '/family/parent/books' && method === 'POST') {
    const childId = String(body['child_id']);
    const subjectId = Number(body['subject_id']);
    if (books.some((b) => b.subject_id === subjectId && b.child_ids.includes(childId))) {
      return envelope(route, 409, null, 'BOOK_EXISTS');
    }
    const child = server.family.children.find((c) => c.id === childId);
    const book: FakeBook = {
      id: next('book'),
      subject_id: subjectId,
      upload_mode: String(body['upload_mode']),
      status: 'getting_ready',
      class_level: child?.class_level ?? 3,
      child_ids: [childId],
      chapters: [],
      uploads: [],
    };
    books.push(book);
    return envelope(route, 201, bookView(book));
  }
  for (const book of books) {
    // P9 (Plan 7.4): the book goes for every child; replaced books are kept for checks
    if (path === `/family/parent/books/${book.id}/replace` && method === 'POST') {
      books.splice(books.indexOf(book), 1);
      server.family.replaced.push(book.id);
      return envelope(route, 200, {
        id: book.id,
        child_ids: book.child_ids,
        chapters: book.chapters.length,
        attempts: 0,
      });
    }
    if (path === `/family/parent/books/${book.id}/chapter-order` && method === 'PUT') {
      const ids = (body['chapter_ids'] ?? []) as string[];
      if (book.upload_mode !== 'chapterwise') {
        return envelope(route, 409, null, 'CONFLICT');
      }
      const known = new Set(book.chapters.map((c) => c.id));
      if (ids.length !== known.size || !ids.every((id) => known.delete(id))) {
        return envelope(route, 400, null, 'VALIDATION_FAILED', {
          fields: { chapter_ids: 'INVALID' },
        });
      }
      const numbers = book.chapters.map((c) => c.number).sort((a, b) => a - b);
      ids.forEach((id, i) => {
        const chapter = book.chapters.find((c) => c.id === id);
        if (chapter) {
          chapter.number = numbers[i];
        }
      });
      book.chapters.sort((a, b) => a.number - b.number);
      return envelope(route, 200, book.chapters.map(chapterView));
    }
    if (path === `/family/parent/books/${book.id}/share` && method === 'POST') {
      const childId = String(body['child_id']);
      const child = server.family.children.find((c) => c.id === childId);
      if ((child?.class_level ?? 3) !== book.class_level) {
        return envelope(route, 409, null, 'BOOK_MISMATCH');
      }
      if (!book.child_ids.includes(childId)) {
        book.child_ids.push(childId);
      }
      return envelope(route, 200, bookView(book));
    }
    if (path === `/family/parent/books/${book.id}/uploads` && method === 'POST') {
      const files = (body['files'] ?? []) as { name: string; type: string; size: number }[];
      const pdf = body['source'] === 'pdf';
      const ok =
        files.length > 0 &&
        (pdf ? files.length === 1 : files.length <= 50) &&
        files.every((f) =>
          pdf
            ? f.type === 'application/pdf' && f.size <= 52428800
            : ['image/jpeg', 'image/png'].includes(f.type) && f.size <= 10485760,
        );
      if (!ok) {
        return envelope(route, 413, null, 'UPLOAD_LIMIT');
      }
      let chapterId: string | null = null;
      const chapter = body['chapter'] as { number: number; title: string } | undefined;
      if (chapter) {
        if (book.chapters.some((c) => c.number === chapter.number)) {
          return envelope(route, 409, null, 'CONFLICT');
        }
        const created: FakeChapter = {
          id: next('chapter'),
          number: chapter.number,
          title: chapter.title,
          status: 'processing',
          page_count: 0,
          unclear_pages: 0,
        };
        book.chapters.push(created);
        chapterId = created.id;
      } else if (book.uploads.some((u) => !['rejected', 'failed'].includes(u.status))) {
        return envelope(route, 409, null, 'BOOK_EXISTS');
      }
      const upload: FakeUpload = {
        id: next('upload'),
        family_book_id: book.id,
        family_chapter_id: chapterId,
        source: String(body['source']),
        status: 'awaiting_files',
        reject_reason: null,
        file_count: files.length,
        names: files.map((f) => f.name),
      };
      book.uploads.push(upload);
      const signed = files.map((f, i) => ({
        id: `${upload.id}-f${i}`,
        name: f.name,
        url: `${url.origin}/fake-storage/${upload.id}/${i}`,
        method: 'PUT',
        headers: { 'Content-Type': f.type },
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      }));
      return envelope(route, 201, uploadView(upload, signed));
    }
    if (path === `/family/parent/books/${book.id}/chapters` && method === 'PUT') {
      // Confirm the split (P6): pages are renumbered over the new chapter starts
      const split = (body['chapters'] ?? []) as {
        number: number;
        title: string;
        start_page: number;
      }[];
      const pages = book.chapters.flatMap((c) => c.pages ?? []);
      const ordered = split.every(
        (c, i) =>
          (i === 0 ? c.start_page === 1 : c.start_page > split[i - 1].start_page) &&
          c.start_page <= pages.length,
      );
      if (!split.length || !ordered) {
        return envelope(route, 400, null, 'VALIDATION_FAILED', {
          fields: { 'chapters[0].start_page': 'INVALID' },
        });
      }
      if (
        book.chapters.some(
          (c) => !['suggested', 'processing', 'needs_attention'].includes(c.status),
        )
      ) {
        return envelope(route, 409, null, 'CONFLICT');
      }
      server.family.splits.push(split);
      book.chapters = split.map((c, i) => {
        const end = i + 1 < split.length ? split[i + 1].start_page - 1 : pages.length;
        const own = pages.slice(c.start_page - 1, end).map((p, n) => ({ ...p, page_no: n + 1 }));
        return {
          id: book.chapters[i]?.id ?? next('chapter'),
          number: c.number,
          title: c.title,
          status: own.some((p) => p.quality === 'unclear') ? 'needs_attention' : 'processing',
          page_count: own.length,
          unclear_pages: 0,
          pages: own,
        };
      });
      return envelope(route, 200, book.chapters.map(chapterView));
    }
    for (const chapter of book.chapters) {
      if (path === `/family/parent/chapters/${chapter.id}` && method === 'DELETE') {
        book.chapters.splice(book.chapters.indexOf(chapter), 1);
        return envelope(route, 200, { id: chapter.id });
      }
      if (path === `/family/parent/chapters/${chapter.id}/pages` && method === 'GET') {
        const quality = url.searchParams.get('quality');
        return envelope(
          route,
          200,
          (chapter.pages ?? [])
            .filter((p) => !quality || p.quality === quality)
            .map((p) => ({
              ...p,
              confidence: p.quality === 'unclear' ? 31.5 : 91,
              image_url: PAGE_IMAGE,
            })),
        );
      }
      for (const pageRow of chapter.pages ?? []) {
        if (path === `/family/parent/pages/${pageRow.id}/retake` && method === 'POST') {
          const upload: FakeUpload = {
            id: next('upload'),
            family_book_id: book.id,
            family_chapter_id: chapter.id,
            source: 'photos',
            status: 'awaiting_files',
            reject_reason: null,
            file_count: 1,
            names: [String(body['name'])],
            retake_page_id: pageRow.id,
          };
          book.uploads.push(upload);
          return envelope(
            route,
            201,
            uploadView(upload, [
              {
                id: `${upload.id}-f0`,
                name: String(body['name']),
                url: `${url.origin}/fake-storage/${upload.id}/0`,
                method: 'PUT',
                headers: { 'Content-Type': String(body['type']) },
                expires_at: new Date(Date.now() + 600_000).toISOString(),
              },
            ]),
          );
        }
      }
    }
  }
  for (const book of books) {
    for (const upload of book.uploads) {
      if (path === `/family/parent/uploads/${upload.id}/complete` && method === 'POST') {
        const retaken = book.chapters
          .flatMap((c) => c.pages ?? [])
          .find((p) => p.id === upload.retake_page_id);
        if (retaken && upload.status === 'awaiting_files') {
          retaken.quality = 'retaken';
        }
        if (upload.status === 'awaiting_files') {
          if (upload.names.some((n) => n.includes('not-a-photo'))) {
            upload.status = 'rejected';
            upload.reject_reason = 'wrong_type';
            const chapter = book.chapters.find((c) => c.id === upload.family_chapter_id);
            if (chapter) {
              chapter.status = 'needs_attention';
            }
            book.status = 'needs_attention';
          } else {
            upload.status = 'scanning';
          }
        }
        return envelope(route, 200, uploadView(upload));
      }
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}

export interface FakePrepTask {
  id: string;
  status: string;
  opened_at: string;
  mine: boolean;
  assigned: boolean;
  family_chapter_id: string;
  family_book_id: string;
  family_ref: string;
  class_level: number;
  subject: string;
  subject_name: string;
  chapter_number: number;
  chapter_title: string;
  page_count: number;
  catalog_chapter_id: string | null;
}

export interface FakeCatalogBook {
  id: string;
  class_level: number;
  subject: string;
  title: string;
  board: string;
  publisher: string | null;
  edition: string | null;
  chapters: { id: string; number: number; title: string; status: string }[];
}

export interface FakePrep {
  tasks: FakePrepTask[];
  books: FakeCatalogBook[];
}

/** One open task ("sample") for a Class 3 EVS chapter, and one prepared book with a ready chapter. */
function samplePrep(): FakePrep {
  const task = (id: string, chapter: number, title: string, hoursAgo: number): FakePrepTask => ({
    id,
    status: 'open',
    opened_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    mine: false,
    assigned: false,
    family_chapter_id: `fc-${id}`,
    family_book_id: `fb-${id}`,
    family_ref: id === 'sample' ? '3fa85f64' : '9b2c41d0',
    class_level: 3,
    subject: 'evs',
    subject_name: 'EVS',
    chapter_number: chapter,
    chapter_title: title,
    page_count: 2,
    catalog_chapter_id: null,
  });
  return {
    tasks: [task('sample', 2, 'Water', 3), task('second', 1, 'Plants around us', 1)],
    books: [
      {
        id: 'cb-looking',
        class_level: 3,
        subject: 'evs',
        title: 'Looking Around',
        board: 'CBSE',
        publisher: 'NCERT',
        edition: '2026',
        chapters: [{ id: 'cc-plants', number: 1, title: 'Plants around us', status: 'ready' }],
      },
    ],
  };
}

function catalogLink(server: FakeServer, chapterId: string | null) {
  if (!chapterId) {
    return null;
  }
  for (const book of server.prep.books) {
    const chapter = book.chapters.find((c) => c.id === chapterId);
    if (chapter) {
      const items = server.content.items.filter((i) => i.catalog_chapter_id === chapterId);
      const count = (kind: string) =>
        items.filter((i) => i.kind === kind && i.status === 'published').length;
      return {
        catalog_book_id: book.id,
        book_title: book.title,
        catalog_chapter_id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        status: chapter.status,
        published_lessons: count('lesson'),
        published_questions: count('question'),
        unpublished: items.filter((i) => i.status === 'draft' || i.status === 'in_check').length,
      };
    }
  }
  return null;
}

/** S8/S9 (Plan 5.5): queue, claim, pages, catalog search and create, link, mark ready. */
function studioPrep(
  route: Route,
  server: FakeServer,
  path: string,
  method: string,
  newId: () => string,
): Promise<void> {
  const url = new URL(route.request().url());
  const body = (method === 'GET' ? {} : (route.request().postDataJSON() ?? {})) as Record<
    string,
    unknown
  >;
  const prep = server.prep;
  if (path === '/studio/prep-tasks' && method === 'GET') {
    const statuses = (url.searchParams.get('status') ?? 'open').split(',');
    return envelope(
      route,
      200,
      prep.tasks.filter((t) => statuses.includes(t.status)),
    );
  }
  for (const task of prep.tasks) {
    const base = `/studio/prep-tasks/${task.id}`;
    if (path === base && method === 'GET') {
      return envelope(route, 200, { task, catalog: catalogLink(server, task.catalog_chapter_id) });
    }
    if (path === `${base}/claim` && method === 'POST') {
      if (task.status === 'open') {
        Object.assign(task, { status: 'in_progress', mine: true, assigned: true });
      } else if (!(task.status === 'in_progress' && task.mine)) {
        return envelope(route, 409, null, 'CONFLICT');
      }
      return envelope(route, 200, task);
    }
    if (path === `${base}/link` && method === 'POST') {
      const link = catalogLink(server, String(body['catalog_chapter_id']));
      if (!link) {
        return envelope(route, 400, null, 'VALIDATION_FAILED', {
          fields: { catalog_chapter_id: 'INVALID' },
        });
      }
      const chapter = prep.books
        .flatMap((b) => b.chapters)
        .find((c) => c.id === link.catalog_chapter_id);
      task.catalog_chapter_id = link.catalog_chapter_id;
      if (chapter?.status === 'ready') {
        task.status = 'done';
      } else if (chapter) {
        task.status = 'in_progress';
        if (chapter.status === 'not_started') {
          chapter.status = 'in_progress';
        }
      }
      return envelope(route, 200, { task, catalog: catalogLink(server, task.catalog_chapter_id) });
    }
    if (path === `/studio/family-chapters/${task.family_chapter_id}/pages` && method === 'GET') {
      return envelope(
        route,
        200,
        [1, 2].map((n) => ({
          id: `${task.id}-p${n}`,
          page_no: n,
          quality: 'ok',
          text: n === 1 ? 'Water is everywhere around us.' : 'We drink water every day.',
          image_url: PAGE_IMAGE,
        })),
      );
    }
  }
  if (path === '/studio/catalog-books' && method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    return envelope(
      route,
      200,
      prep.books.filter(
        (b) =>
          b.class_level === Number(url.searchParams.get('class')) &&
          b.subject === url.searchParams.get('subject') &&
          b.title.toLowerCase().includes(q),
      ),
    );
  }
  if (path === '/studio/catalog-books' && method === 'POST') {
    const book: FakeCatalogBook = {
      id: `cb-${newId()}`,
      class_level: Number(body['class_level']),
      subject: String(body['subject']),
      title: String(body['title']),
      board: String(body['board'] ?? 'CBSE'),
      publisher: (body['publisher'] as string | undefined) ?? null,
      edition: (body['edition'] as string | undefined) ?? null,
      chapters: [],
    };
    prep.books.push(book);
    return envelope(route, 201, book);
  }
  for (const book of prep.books) {
    if (path === `/studio/catalog-books/${book.id}/chapters` && method === 'POST') {
      if (book.chapters.some((c) => c.number === Number(body['number']))) {
        return envelope(route, 409, null, 'CONFLICT');
      }
      book.chapters.push({
        id: `cc-${newId()}`,
        number: Number(body['number']),
        title: String(body['title']),
        status: 'not_started',
      });
      return envelope(route, 201, book);
    }
    for (const chapter of book.chapters) {
      if (path === `/studio/catalog-chapters/${chapter.id}` && method === 'PATCH') {
        const link = catalogLink(server, chapter.id);
        if (
          !link ||
          link.published_lessons < 1 ||
          link.published_questions < 20 ||
          link.unpublished > 0
        ) {
          return envelope(route, 409, null, 'CONFLICT');
        }
        chapter.status = 'ready';
        for (const task of prep.tasks.filter((t) => t.catalog_chapter_id === chapter.id)) {
          task.status = 'done';
        }
        return envelope(route, 200, catalogLink(server, chapter.id));
      }
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}

export interface FakeMessage {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: Record<string, string> | null;
  read_at: string | null;
  created_at: string;
}

/** P19 messages and P8a previews (Plan 5.5). A chapter's lessons are those of its catalog chapter. */
function familyMessages(
  route: Route,
  server: FakeServer,
  path: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  const family = server.family;
  if (path === '/family/parent/messages' && method === 'GET') {
    const items = [...family.messages].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return envelope(route, 200, {
      items,
      next_cursor: null,
      unread: items.filter((m) => !m.read_at).length,
    });
  }
  for (const message of family.messages) {
    if (path === `/family/parent/messages/${message.id}/read` && method === 'POST') {
      message.read_at ??= new Date().toISOString();
      return envelope(route, 200, message);
    }
  }
  const published = (kind: string, catalogChapterId: string | null | undefined) =>
    server.content.items.filter(
      (i) =>
        i.kind === kind &&
        i.status === 'published' &&
        !!catalogChapterId &&
        i.catalog_chapter_id === catalogChapterId,
    );
  for (const chapter of family.books.flatMap((b) => b.chapters)) {
    if (path === `/family/parent/chapters/${chapter.id}/lessons` && method === 'GET') {
      return envelope(
        route,
        200,
        published('lesson', chapter.catalog_chapter_id).map((i) => ({
          content_item_id: i.id,
          title: i.versions.find((v) => v.id === i.published_version_id)?.title ?? '',
          duration_seconds: 60,
          preview_result: family.previews[i.id] ?? null,
        })),
      );
    }
  }
  const lessons = server.content.items.filter(
    (i) => i.kind === 'lesson' && i.status === 'published',
  );
  for (const item of lessons) {
    const version = item.versions.find((v) => v.id === item.published_version_id);
    const preview = () => ({
      lesson: {
        id: item.id,
        title: version?.title ?? '',
        lang: item.lang,
        duration_seconds: 60,
        body: version?.body,
      },
      questions: published('question', item.catalog_chapter_id).map((q) => {
        const v = q.versions.find((x) => x.id === q.published_version_id);
        return {
          id: q.id,
          title: v?.title ?? '',
          question_type: q.question_type,
          difficulty: q.difficulty,
          body: v?.body,
          solution: v?.solution,
        };
      }),
      preview_result: family.previews[item.id] ?? null,
    });
    if (path === `/family/parent/lessons/${item.id}/preview` && method === 'GET') {
      return envelope(route, 200, preview());
    }
    if (path === `/family/parent/lessons/${item.id}/preview-result` && method === 'POST') {
      const result = String(body['result']);
      if (result === 'reported' && !body['reason']) {
        return envelope(route, 400, null, 'VALIDATION_FAILED', {
          fields: { reason: 'REQUIRED' },
        });
      }
      if (result === 'reported' && family.previews[item.id] !== 'reported') {
        family.reports.push({
          content_item_id: item.id,
          reason: String(body['reason']),
          note: (body['note'] as string | undefined) ?? null,
        });
      }
      family.previews[item.id] = result;
      return envelope(route, 200, preview());
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}

const KID_SUBJECTS = [
  { subject_id: 1, code: 'english', name: 'English' },
  { subject_id: 2, code: 'hindi', name: 'Hindi' },
  { subject_id: 3, code: 'maths', name: 'Maths' },
  { subject_id: 4, code: 'evs', name: 'EVS' },
];

/** Grade-level topics of every subject in the fake: one with the "sample" lesson (the K4 route sample). */
const KID_TOPICS = [
  { id: 't-first', title: 'First steps', done: true },
  { id: 't-sample', title: 'Birds and nests', done: false },
];

/** K1–K3 (Plan 6.1). A subject is "My book" once the child's book has a chapter ready to read along. */
function familyKid(route: Route, server: FakeServer, path: string): Promise<void> {
  const childId = route.request().headers()['x-child-id'];
  const child = server.family.children.find((c) => c.id === childId);
  if (!child) {
    return envelope(route, 403, null, 'CHILD_NOT_IN_FAMILY');
  }
  const ready = ['readalong_ready', 'lessons_being_prepared', 'lessons_ready'];
  const bookOf = (subjectId: number) =>
    server.family.books.find((b) => b.subject_id === subjectId && b.child_ids.includes(child.id));
  const readyChapters = (subjectId: number) =>
    (bookOf(subjectId)?.chapters ?? []).filter((c) => ready.includes(c.status));
  if (path === '/family/kid/sync' && route.request().method() === 'POST') {
    // Schema §11: attempts upsert by id, stars from the counts (0 of anything = 1, >50% = 2, >80% = 3)
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown[]>;
    server.family.syncs.push({ childId: child.id, body });
    for (const raw of (body['attempts'] ?? []) as Record<string, unknown>[]) {
      const id = String(raw['id']);
      const done = raw['completed_at'] as string | null;
      const correct = raw['correct_count'] as number | null;
      const total = raw['total_count'] as number | null;
      const share = correct !== null && total ? correct / total : null;
      const stars = !done ? 0 : share === null ? 1 : share > 0.8 ? 3 : share > 0.5 ? 2 : 1;
      if (!server.family.attempts[id]?.completed_at) {
        server.family.attempts[id] = { stars, completed_at: done };
      }
    }
    const earned = Object.values(server.family.attempts).reduce((sum, a) => sum + a.stars, 0);
    return envelope(route, 200, {
      stars_total: 12 + earned,
      minutes_today: 5,
      accepted: {
        attempts: (body['attempts'] ?? []).length,
        answers: (body['answers'] ?? []).length,
        minutes: (body['minutes'] ?? []).length,
      },
      rejected: { attempts: 0, answers: 0, minutes: 0 },
    });
  }
  // K8–K11 (Plan 7.1): English and EVS have questions, Hindi none yet; mistakes as the server holds them
  const practiceQuestion = (id: string, prompt: string, right: string, wrong: string) => ({
    id,
    version_id: `${id}-v1`,
    question_type: 'mcq',
    topic_id: 't-sample',
    body: {
      prompt,
      image_key: null,
      options: [
        { id: 'a', text: right },
        { id: 'b', text: wrong },
      ],
    },
    solution: { correct: ['a'], explanation: `${right} is right.` },
  });
  const sets: Record<number, ReturnType<typeof practiceQuestion>[]> = {
    1: [
      practiceQuestion('p-noun', 'Which word is a noun?', 'bird', 'run'),
      practiceQuestion('p-verb', 'Which word is a verb?', 'jump', 'blue'),
    ],
    4: [practiceQuestion('p-plant', 'Plants need?', 'water', 'stones')],
  };
  const onScreen = /^\/family\/kid\/worksheets\/([^/]+)\/onscreen$/.exec(path);
  if (onScreen) {
    const w = server.family.worksheets.find((x) => x.id === onScreen[1] && x.child_id === child.id);
    if (!w) {
      return envelope(route, 404, null, 'NOT_FOUND');
    }
    w.printed_at ??= new Date().toISOString();
    return envelope(route, 200, {
      worksheet: { ...w, order: undefined, weak_spots: undefined, pdf_requests: undefined },
      questions: w.order.map((id, i) => ({
        ...WORKSHEET_QUESTIONS.find((q) => q.id === id)!,
        position: i + 1,
      })),
      weak_spots: [],
    });
  }
  if (path === '/family/kid/practice') {
    return envelope(route, 200, {
      subjects: KID_SUBJECTS.map((s) => ({
        ...s,
        questions: sets[s.subject_id]?.length ?? 0,
        topics: [{ id: 't-sample', name: 'Birds and nests', questions: 6 }],
      })),
      mistakes: server.family.mistakes.length,
    });
  }
  if (path === '/family/kid/practice-sets' && route.request().method() === 'POST') {
    const subjectId = Number(
      (route.request().postDataJSON() as Record<string, unknown>)['subject_id'],
    );
    return envelope(route, 200, {
      kind: 'practice',
      subject_id: subjectId,
      topic_id: null,
      questions: sets[subjectId] ?? [],
    });
  }
  if (path === '/family/kid/mistakes') {
    return envelope(route, 200, {
      kind: 'mistakes',
      subject_id: server.family.mistakes.length ? 1 : 0,
      topic_id: null,
      questions: sets[1].filter((q) => server.family.mistakes.includes(q.id)),
    });
  }
  if (path === '/family/kid/lessons/sample') {
    return envelope(route, 200, {
      id: 'sample',
      version_id: 'sample-v1',
      title: 'Birds build nests',
      lang: 'en',
      duration_seconds: 20,
      subject_id: 1,
      topic_id: 't-sample',
      catalog_chapter_id: null,
      body: {
        scenes: [
          {
            id: 's1',
            duration_ms: 60000,
            text: 'A bird builds a nest.',
            visual: { illustration: 'subject-evs', animation: 'fade-up' },
          },
          { id: 'q1', duration_ms: 0, quiz: { question_item_id: 'q-nest' } },
          { id: 's2', duration_ms: 60000, text: 'Now the eggs are safe.', visual: null },
        ],
      },
      questions: [
        {
          id: 'q-nest',
          version_id: 'q-nest-v1',
          question_type: 'mcq',
          topic_id: 't-sample',
          body: {
            prompt: 'What does a bird build?',
            image_key: null,
            options: [
              { id: 'a', text: 'A nest' },
              { id: 'b', text: 'A car' },
            ],
          },
          solution: { correct: ['a'], explanation: 'Birds build nests for their eggs.' },
        },
      ],
      resume: null,
      narration: server.family.lessonNarrated
        ? {
            audio_url: SILENT_MP3,
            scenes: [
              { id: 's1', start_ms: 0, end_ms: 900 },
              { id: 's2', start_ms: 1100, end_ms: 1900 },
            ],
          }
        : null,
    });
  }
  if (path === '/family/kid/home') {
    return envelope(route, 200, {
      child: {
        id: child.id,
        first_name: child.first_name,
        class_level: child.class_level ?? 3,
        avatar_key: child.avatar_key,
      },
      stars: 12,
      minutes_today: 5,
      daily_limit_minutes: server.family.dailyLimitMinutes,
      subjects: KID_SUBJECTS.map((s) => ({
        ...s,
        mode: readyChapters(s.subject_id).length ? 'book' : 'practice',
      })),
      continue_card: null,
    });
  }
  for (const subject of KID_SUBJECTS) {
    if (path === `/family/kid/subjects/${subject.subject_id}`) {
      const chapters = readyChapters(subject.subject_id);
      return envelope(route, 200, {
        ...subject,
        mode: chapters.length ? 'book' : 'practice',
        entries: chapters.length
          ? chapters.map((c) => ({ id: c.id, number: c.number, title: c.title, done: false }))
          : KID_TOPICS.map((t) => ({ id: t.id, number: null, title: t.title, done: t.done })),
      });
    }
    for (const chapter of readyChapters(subject.subject_id)) {
      if (path === `/family/kid/chapters/${chapter.id}/pages`) {
        return envelope(route, 200, {
          id: chapter.id,
          number: chapter.number,
          title: chapter.title,
          subject_id: subject.subject_id,
          lang: 'en',
          pages: [
            {
              id: `${chapter.id}-p1`,
              page_no: 1,
              text: 'Rain falls down.',
              image_url: PAGE_IMAGE,
              audio_url: SILENT_MP3,
              word_timings: [
                { w: 'Rain', start_ms: 300, end_ms: 620 },
                { w: 'falls', start_ms: 700, end_ms: 1020 },
                { w: 'down.', start_ms: 1100, end_ms: 1420 },
              ],
            },
            {
              id: `${chapter.id}-p2`,
              page_no: 2,
              text: 'The pond is full.',
              image_url: PAGE_IMAGE,
              audio_url: null,
              word_timings: [],
            },
          ],
          resume: null,
        });
      }
      if (path === `/family/kid/chapters/${chapter.id}`) {
        const lessons = server.content.items.filter(
          (i) =>
            i.kind === 'lesson' &&
            i.status === 'published' &&
            !!chapter.catalog_chapter_id &&
            i.catalog_chapter_id === chapter.catalog_chapter_id,
        );
        return envelope(route, 200, {
          kind: 'chapter',
          id: chapter.id,
          title: chapter.title,
          number: chapter.number,
          subject_id: subject.subject_id,
          subject: subject.code,
          lessons: lessons.map((i) => ({
            content_item_id: i.id,
            title: i.versions.find((v) => v.id === i.published_version_id)?.title ?? '',
            duration_seconds: 60,
            done: false,
          })),
          read_along: true,
          worksheet: false,
        });
      }
    }
  }
  for (const topic of KID_TOPICS) {
    if (path === `/family/kid/topics/${topic.id}`) {
      return envelope(route, 200, {
        kind: 'topic',
        id: topic.id,
        title: topic.title,
        number: null,
        subject_id: 1,
        subject: 'english',
        lessons:
          topic.id === 't-sample'
            ? [
                {
                  content_item_id: 'sample',
                  title: 'Birds build nests',
                  duration_seconds: 120,
                  done: false,
                },
              ]
            : [],
        read_along: false,
        worksheet: true,
        worksheet_id:
          [...server.family.worksheets]
            .reverse()
            .find((w) => w.child_id === child.id && w.topic_id === topic.id)?.id ?? null,
      });
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}

/** About 2 s of silence as MPEG-1 Layer III frames, like the read-along stand-in (Plan 5.4). */
const SILENT_MP3 = (() => {
  const frames = 80;
  const bytes = Buffer.alloc(frames * 104);
  for (let f = 0; f < frames; f++) {
    bytes.set([0xff, 0xfb, 0x10, 0xc0], f * 104);
  }
  return `data:audio/mpeg;base64,${bytes.toString('base64')}`;
})();

export interface FakeWorksheet {
  id: string;
  child_id: string;
  subject_id: number;
  subject: string;
  subject_name: string;
  source: string;
  family_chapter_id: string | null;
  topic_id: string | null;
  source_title: string;
  chapter_number: number | null;
  question_count: number;
  status: string;
  printed_at: string | null;
  created_at: string;
  /** Question ids in order; a shuffle reverses them. */
  order: string[];
  weak_spots: string[];
  pdf_requests: number;
}

const WORKSHEET_QUESTIONS = Array.from({ length: 6 }, (_, i) => ({
  id: `wq-${i + 1}`,
  version_id: `wq-${i + 1}-v1`,
  question_type: 'mcq',
  topic_id: i < 3 ? 't-water' : 't-air',
  topic_name: i < 3 ? 'Saving water' : 'Air around us',
  body: {
    prompt: `Worksheet question ${i + 1}`,
    image_key: null,
    options: [
      { id: 'a', text: `Right ${i + 1}` },
      { id: 'b', text: `Wrong ${i + 1}` },
    ],
  },
  solution: { correct: ['a'], explanation: `Because ${i + 1}.` },
}));

/** A tiny PDF for P12 (the real one comes from Gotenberg). */
const FAKE_PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% fake worksheet\n%%EOF\n').toString('base64')}`;

/** P10–P13 (Plan 7.2): the first PDF request is still rendering (202), the next is ready. */
function familyWorksheets(
  route: Route,
  server: FakeServer,
  path: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  const all = server.family.worksheets;
  const summary = (w: FakeWorksheet) => {
    const view: Partial<FakeWorksheet> = { ...w };
    delete view.order;
    delete view.weak_spots;
    delete view.pdf_requests;
    return view;
  };
  const detail = (w: FakeWorksheet, solutions: boolean) => ({
    worksheet: summary(w),
    questions: w.order.map((id, i) => {
      const q = WORKSHEET_QUESTIONS.find((x) => x.id === id)!;
      return { ...q, position: i + 1, solution: solutions ? q.solution : null };
    }),
    weak_spots: w.weak_spots,
  });
  if (path === '/family/parent/worksheets' && method === 'GET') {
    return envelope(route, 200, [...all].reverse().map(summary));
  }
  if (path === '/family/parent/worksheets' && method === 'POST') {
    const count = Number(body['question_count']);
    if (count > WORKSHEET_QUESTIONS.length) {
      return envelope(route, 400, null, 'VALIDATION_FAILED', {
        fields: { question_count: 'OUT_OF_RANGE' },
      });
    }
    const chapter = body['source'] === 'chapter';
    const w: FakeWorksheet = {
      id: `ws-${all.length + 1}`,
      child_id: String(body['child_id']),
      subject_id: Number(body['subject_id']),
      subject: 'evs',
      subject_name: 'EVS',
      source: String(body['source']),
      family_chapter_id: chapter ? String(body['family_chapter_id']) : null,
      topic_id: chapter ? null : String(body['topic_id']),
      source_title: chapter ? 'Water' : 'Birds and nests',
      chapter_number: chapter ? 2 : null,
      question_count: count,
      status: 'rendering',
      printed_at: null,
      created_at: new Date().toISOString(),
      order: WORKSHEET_QUESTIONS.slice(0, count).map((q) => q.id),
      weak_spots: [],
      pdf_requests: 0,
    };
    all.push(w);
    return envelope(route, 201, detail(w, false));
  }
  for (const w of all) {
    const base = `/family/parent/worksheets/${w.id}`;
    if (path === `${base}/reshuffle` && method === 'POST') {
      if (w.printed_at) {
        return envelope(route, 409, null, 'CONFLICT');
      }
      w.order = [...w.order].reverse();
      return envelope(route, 200, detail(w, false));
    }
    if (path === `${base}/pdf` && method === 'GET') {
      w.printed_at ??= new Date().toISOString();
      w.pdf_requests++;
      if (w.pdf_requests === 1) {
        return envelope(route, 202, { status: 'rendering', url: null, expires_at: null });
      }
      w.status = 'ready';
      return envelope(route, 200, { status: 'ready', url: FAKE_PDF, expires_at: null });
    }
    if (path === `${base}/solutions` && method === 'GET') {
      return envelope(route, 200, detail(w, true));
    }
    if (path === `${base}/weak-spots` && method === 'PUT') {
      w.weak_spots = (body['topic_ids'] as string[]) ?? [];
      return envelope(route, 200, detail(w, true));
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}

export interface FakeProblemReport {
  id: string;
  status: 'open' | 'fixed' | 'dismissed';
  reason: string;
  note: string | null;
  created_at: string;
  content_item_id: string;
  kind: 'lesson' | 'question' | 'passage';
  title: string;
  version_no: number;
  family_ref: string;
  handled_at: string | null;
}

export interface FakeTicket {
  id: string;
  subject: string;
  status: 'open' | 'answered' | 'closed';
  family_ref: string;
  created_at: string;
  updated_at: string;
  messages: { id: string; author: 'parent' | 'staff'; body: string; created_at: string }[];
}

export interface FakeSupport {
  reports: FakeProblemReport[];
  tickets: FakeTicket[];
}

function sampleSupport(): FakeSupport {
  return {
    reports: [
      {
        id: 'r1',
        status: 'open',
        reason: 'wrong_answer',
        note: 'The answer should be 12.',
        created_at: '2026-10-20T09:00:00Z',
        content_item_id: 'sample',
        kind: 'lesson',
        title: 'Birds and nests',
        version_no: 1,
        family_ref: 'F-1a2b',
        handled_at: null,
      },
    ],
    tickets: [
      {
        id: 'tk1',
        subject: 'Lessons will not load',
        status: 'open',
        family_ref: 'F-1a2b',
        created_at: '2026-10-21T09:00:00Z',
        updated_at: '2026-10-21T09:00:00Z',
        messages: [
          {
            id: 'tm1',
            author: 'parent',
            body: 'The English lessons show a spinner.',
            created_at: '2026-10-21T09:00:00Z',
          },
        ],
      },
    ],
  };
}

function ticketSummary(t: FakeTicket) {
  const last = t.messages.at(-1);
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    family_ref: t.family_ref,
    updated_at: t.updated_at,
    last_message: last?.body ?? null,
    last_author: last?.author ?? null,
  };
}

function addTicketMessage(t: FakeTicket, author: 'parent' | 'staff', body: string): void {
  const now = new Date().toISOString();
  t.messages.push({ id: `${t.id}-m${t.messages.length + 1}`, author, body, created_at: now });
  t.updated_at = now;
  t.status = author === 'staff' ? 'answered' : 'open';
}

function trimmed(body: Record<string, unknown>, key: string, max: number): string | null {
  const raw = body[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value && value.length <= max ? value : null;
}

/** P18 Report a problem and P16 Contact us (Plan 7.3); this family is "F-you". */
function familySupport(
  route: Route,
  server: FakeServer,
  path: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  const support = server.support;
  if (path === '/family/parent/problem-reports' && method === 'POST') {
    const item = String(body['content_item_id'] ?? '');
    const report: FakeProblemReport = {
      id: `r${support.reports.length + 1}`,
      status: 'open',
      reason: String(body['reason']),
      note: (body['note'] as string | undefined) ?? null,
      created_at: new Date().toISOString(),
      content_item_id: item,
      kind: 'question',
      title: 'Question',
      version_no: 1,
      family_ref: 'F-you',
      handled_at: null,
    };
    support.reports.push(report);
    const { id, content_item_id, reason, note, status, created_at } = report;
    return envelope(route, 201, { id, content_item_id, reason, note, status, created_at });
  }
  if (path === '/family/parent/support-tickets' && method === 'GET') {
    return envelope(
      route,
      200,
      support.tickets
        .filter((t) => t.family_ref === 'F-you')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );
  }
  if (path === '/family/parent/support-tickets' && method === 'POST') {
    const subject = trimmed(body, 'subject', 120);
    const message = trimmed(body, 'body', 2000);
    if (!subject || !message) {
      return envelope(route, 400, null, 'VALIDATION_FAILED', {
        fields: {
          ...(subject ? {} : { subject: 'REQUIRED' }),
          ...(message ? {} : { body: 'REQUIRED' }),
        },
      });
    }
    const now = new Date().toISOString();
    const ticket: FakeTicket = {
      id: `tk${support.tickets.length + 1}`,
      subject,
      status: 'open',
      family_ref: 'F-you',
      created_at: now,
      updated_at: now,
      messages: [],
    };
    addTicketMessage(ticket, 'parent', message);
    support.tickets.push(ticket);
    return envelope(route, 201, ticket);
  }
  const ticket = support.tickets.find(
    (t) => t.family_ref === 'F-you' && path === `/family/parent/support-tickets/${t.id}/messages`,
  );
  if (ticket && method === 'POST') {
    const message = trimmed(body, 'body', 2000);
    if (!message) {
      return envelope(route, 400, null, 'VALIDATION_FAILED', { fields: { body: 'REQUIRED' } });
    }
    addTicketMessage(ticket, 'parent', message);
    return envelope(route, 201, ticket);
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}

/** S7 problem reports and S12 support inbox (Plan 7.3); a reply also lands in P19. */
function studioSupport(
  route: Route,
  server: FakeServer,
  path: string,
  method: string,
): Promise<void> {
  const support = server.support;
  const query = new URL(route.request().url()).searchParams;
  const body = (method === 'GET' ? {} : (route.request().postDataJSON() ?? {})) as Record<
    string,
    unknown
  >;
  if (path === '/studio/problem-reports' && method === 'GET') {
    const status = query.get('status') ?? 'open';
    return envelope(
      route,
      200,
      support.reports
        .filter((r) => r.status === status)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }
  const report = support.reports.find((r) => path === `/studio/problem-reports/${r.id}`);
  if (report && method === 'PATCH') {
    if (report.status !== 'open') {
      return envelope(route, 409, null, 'CONFLICT');
    }
    report.status = body['status'] === 'fixed' ? 'fixed' : 'dismissed';
    report.handled_at = new Date().toISOString();
    return envelope(route, 200, report);
  }
  if (path === '/studio/support-tickets' && method === 'GET') {
    const statuses = (query.get('status') ?? 'open').split(',');
    return envelope(
      route,
      200,
      support.tickets
        .filter((t) => statuses.includes(t.status))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(ticketSummary),
    );
  }
  const view = (t: FakeTicket) => ({ ticket: ticketSummary(t), messages: t.messages });
  for (const ticket of support.tickets) {
    if (path === `/studio/support-tickets/${ticket.id}` && method === 'GET') {
      return envelope(route, 200, view(ticket));
    }
    if (path === `/studio/support-tickets/${ticket.id}/messages` && method === 'POST') {
      const message = trimmed(body, 'body', 2000);
      if (!message) {
        return envelope(route, 400, null, 'VALIDATION_FAILED', { fields: { body: 'REQUIRED' } });
      }
      addTicketMessage(ticket, 'staff', message);
      server.family.messages.push({
        id: `${ticket.id}-reply-${ticket.messages.length}`,
        kind: 'support_reply',
        title: 'Reply from our team',
        body: message,
        link: { screen: 'P16', ticket_id: ticket.id },
        read_at: null,
        created_at: new Date().toISOString(),
      });
      return envelope(route, 201, view(ticket));
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}

export interface FakeReadingTest {
  id: string;
  child_id: string;
  passage_item_id: string;
  status: 'awaiting_audio' | 'processing' | 'scored' | 'not_understood' | 'failed';
  test_date: string;
  stars: number;
  accuracy_pct: number | null;
  words_per_minute: number | null;
  words_read: number | null;
  word_count: number | null;
  words_to_practise: string[];
  recording_type: string | null;
}

export interface FakeReading {
  /** What "the worker" gives the next submitted test. */
  outcome: 'scored' | 'not_understood' | 'failed';
  level: number;
  tests: FakeReadingTest[];
  /** Set to null for a class without passages. */
  passage: {
    id: string;
    version_id: string;
    title: string;
    lang: 'en' | 'hi';
    text: string;
    word_count: number;
    level: number;
  } | null;
}

function sampleReading(): FakeReading {
  return {
    outcome: 'scored',
    level: 1,
    tests: [],
    passage: {
      id: 'passage-kite',
      version_id: 'passage-kite-v1',
      title: "Ravi's red kite",
      lang: 'en',
      text: 'Ravi has a red kite. On Sunday, he goes to the park with his sister Asha.',
      word_count: 16,
      level: 1,
    },
  };
}

const TODAY = () => new Date().toISOString().slice(0, 10);

/** K12–K14 and P3 (Plan 8.3). A submitted test is scored on the next poll, as the worker would. */
function familyReading(
  route: Route,
  server: FakeServer,
  path: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  const reading = server.reading;
  const history = /^\/family\/parent\/children\/([^/]+)\/reading-tests$/.exec(path);
  if (history && method === 'GET') {
    const childId = history[1];
    if (!server.family.children.some((c) => c.id === childId)) {
      return envelope(route, 404, null, 'NOT_FOUND');
    }
    return envelope(
      route,
      200,
      reading.tests
        .filter((t) => t.child_id === childId && t.status !== 'awaiting_audio')
        .reverse()
        .map((t) => ({
          id: t.id,
          test_date: t.test_date,
          title: reading.passage?.title ?? 'Story',
          lang: reading.passage?.lang ?? 'en',
          status: t.status,
          accuracy_pct: t.accuracy_pct,
          words_per_minute: t.words_per_minute,
          words_to_practise: t.words_to_practise,
          stars: t.stars,
          recording_url: `${new URL(route.request().url()).origin}/fake-storage/recordings/${t.id}.webm`,
          recording_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        })),
    );
  }
  const childId = route.request().headers()['x-child-id'];
  if (!server.family.children.some((c) => c.id === childId)) {
    return envelope(route, 403, null, 'CHILD_NOT_IN_FAMILY');
  }
  const mine = reading.tests.filter((t) => t.child_id === childId);
  const today = mine.filter((t) => t.test_date === TODAY()).length;
  const view = (t: FakeReadingTest, upload = false) => ({
    ...t,
    title: reading.passage?.title ?? '',
    lang: reading.passage?.lang ?? 'en',
    tests_left_today: Math.max(0, 2 - mine.filter((x) => x.test_date === TODAY()).length),
    level: reading.level,
    upload: upload
      ? {
          url: `${new URL(route.request().url()).origin}/fake-storage/recordings/${t.id}.webm`,
          method: 'PUT',
          headers: { 'Content-Type': t.recording_type ?? 'audio/webm' },
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        }
      : null,
  });
  if (path === '/family/kid/reading' && method === 'GET') {
    const last = [...mine].reverse().find((t) => t.status === 'scored');
    return envelope(route, 200, {
      passage: reading.passage,
      level: reading.level,
      tests_left_today: Math.max(0, 2 - today),
      any_tests: mine.length > 0,
      last_result: last
        ? {
            id: last.id,
            test_date: last.test_date,
            accuracy_pct: last.accuracy_pct,
            words_per_minute: last.words_per_minute,
            words_to_practise: last.words_to_practise,
            stars: last.stars,
          }
        : null,
    });
  }
  if (path === '/family/kid/reading-tests' && method === 'POST') {
    if (body['passage_item_id'] !== reading.passage?.id) {
      return envelope(route, 400, null, 'VALIDATION_FAILED', {
        fields: { passage_item_id: 'INVALID' },
      });
    }
    if (today >= 2) {
      return envelope(route, 429, null, 'READING_LIMIT');
    }
    const test: FakeReadingTest = {
      id: String(body['id']),
      child_id: childId,
      passage_item_id: String(body['passage_item_id']),
      status: 'awaiting_audio',
      test_date: TODAY(),
      stars: 0,
      accuracy_pct: null,
      words_per_minute: null,
      words_read: null,
      word_count: null,
      words_to_practise: [],
      recording_type: String(body['content_type']),
    };
    reading.tests.push(test);
    return envelope(route, 201, view(test, true));
  }
  for (const test of mine) {
    if (path === `/family/kid/reading-tests/${test.id}/submit` && method === 'POST') {
      if (!server.family.stored.includes(`/fake-storage/recordings/${test.id}.webm`)) {
        return envelope(route, 400, null, 'VALIDATION_FAILED', {
          fields: { recording: 'REQUIRED' },
        });
      }
      if (test.status === 'awaiting_audio') {
        test.status = 'processing';
      }
      return envelope(route, 200, view(test));
    }
    if (path === `/family/kid/reading-tests/${test.id}` && method === 'GET') {
      if (test.status === 'processing') {
        test.status = reading.outcome;
        if (reading.outcome === 'scored') {
          Object.assign(test, {
            stars: 3,
            accuracy_pct: 87.5,
            words_per_minute: 96,
            words_read: 14,
            word_count: 16,
            words_to_practise: ['red', 'park'],
          });
        }
      }
      return envelope(route, 200, view(test));
    }
  }
  return envelope(route, 404, null, 'NOT_FOUND');
}
