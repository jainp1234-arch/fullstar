import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AUTH_CONFIG, AuthConfig } from '../auth/auth-config';
import { AuthService } from '../auth/auth.service';
import { FamilyApi } from '../family/family-api';
import { FamilySession } from '../family/family-session';
import { ApiClient } from './api-client';
import { ApiError, parseEnvelope, toApiError } from './api-error';
import { API_INTERCEPTORS } from './interceptors';

const CONFIG: AuthConfig = {
  url: 'http://localhost/auth',
  realm: 'fullstar',
  clientId: 'family-app',
  scope: 'openid',
  persist: false,
  redirectPath: '/sign-in/code',
  signedOutPath: '/welcome',
};

class FakeAuth {
  current: string | null = 'token-1';
  refreshes = 0;
  authenticated = () => this.current !== null;
  token = async () => this.current;
  refreshNow = async () => {
    this.refreshes++;
    this.current = 'token-2';
    return true;
  };
}

function ok<T>(data: T) {
  return { status: 'success', data, error: null };
}

function fail(code: string, extra: Record<string, unknown> = {}) {
  return { status: 'error', data: null, error: { code, message: code, ...extra } };
}

describe('envelope parsing', () => {
  it('returns data from a success envelope', () => {
    expect(parseEnvelope<{ a: number }>(ok({ a: 1 }))).toEqual({ a: 1 });
  });

  it('rejects anything else', () => {
    expect(() => parseEnvelope({ a: 1 })).toThrow(ApiError);
    expect(() => parseEnvelope('<html>')).toThrow('expected format');
  });

  it('maps an error envelope with fields and retry_after_s', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 423,
        error: fail('PIN_LOCKED', { fields: { pin: 'WRONG', bad: 3 }, retry_after_s: 42 }),
      }),
    );
    expect(error).toMatchObject({ status: 423, code: 'PIN_LOCKED', retryAfterS: 42 });
    expect(error.fields).toEqual({ pin: 'WRONG' });
  });

  it('maps no response to NETWORK and bare statuses to codes', () => {
    expect(toApiError(new HttpErrorResponse({ status: 0 })).code).toBe('NETWORK');
    expect(toApiError(new HttpErrorResponse({ status: 502, error: 'Bad gateway' })).code).toBe(
      'DEPENDENCY_UNAVAILABLE',
    );
    expect(
      toApiError(new HttpErrorResponse({ status: 500, error: fail('SOMETHING_NEW') })).code,
    ).toBe('INTERNAL_ERROR');
  });
});

describe('ApiClient with the interceptors', () => {
  let http: HttpTestingController;
  let api: ApiClient;
  let auth: FakeAuth;
  let session: FamilySession;

  beforeEach(() => {
    vi.useFakeTimers();
    auth = new FakeAuth();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(API_INTERCEPTORS)),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTH_CONFIG, useValue: CONFIG },
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ApiClient);
    session = TestBed.inject(FamilySession);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  /** The interceptors await the token before sending. */
  async function expectOne(url: string) {
    await vi.advanceTimersByTimeAsync(0);
    return http.expectOne(url);
  }

  it('sends the bearer token to the API and unwraps data', async () => {
    const result = firstValueFrom(api.get<{ ok: boolean }>('/family/me'));
    const req = await expectOne('/api/v1/family/me');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(req.request.headers.has('Idempotency-Key')).toBe(false);
    req.flush(ok({ ok: true }));
    await expect(result).resolves.toEqual({ ok: true });
  });

  it('refuses paths that leave /api/v1', () => {
    expect(() => api.get('//evil.example/x')).toThrow(ApiError);
    expect(() => api.get('/../auth')).toThrow(ApiError);
  });

  it('keeps the same Idempotency-Key across retries of a write', async () => {
    const result = firstValueFrom(api.post('/family/me', { consent_version: 'v1' }));
    const first = await expectOne('/api/v1/family/me');
    const key = first.request.headers.get('Idempotency-Key');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    first.flush(fail('DEPENDENCY_UNAVAILABLE'), { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(400);
    const second = await expectOne('/api/v1/family/me');
    expect(second.request.headers.get('Idempotency-Key')).toBe(key);
    second.flush(ok({ created: true }), { status: 201, statusText: 'Created' });
    await expect(result).resolves.toEqual({ created: true });
  });

  it('does not retry a write without a key, nor a 4xx', async () => {
    const write = firstValueFrom(
      api.post('/family/pin/verify', { pin: '1234' }, { idempotent: false }),
    );
    const req = await expectOne('/api/v1/family/pin/verify');
    expect(req.request.headers.has('Idempotency-Key')).toBe(false);
    req.flush(fail('DEPENDENCY_UNAVAILABLE'), { status: 503, statusText: 'Unavailable' });
    await expect(write).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });

    const read = firstValueFrom(api.get('/family/me'));
    (await expectOne('/api/v1/family/me')).flush(fail('VALIDATION_FAILED'), {
      status: 400,
      statusText: 'Bad request',
    });
    await expect(read).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refreshes once and retries after 401 UNAUTHENTICATED', async () => {
    const result = firstValueFrom(api.get('/family/me'));
    (await expectOne('/api/v1/family/me')).flush(fail('UNAUTHENTICATED'), {
      status: 401,
      statusText: 'Unauthorized',
    });
    const retried = await expectOne('/api/v1/family/me');
    expect(auth.refreshes).toBe(1);
    expect(retried.request.headers.get('Authorization')).toBe('Bearer token-2');
    retried.flush(ok({ again: true }));
    await expect(result).resolves.toEqual({ again: true });
  });

  it('adds X-Child-Id only to kid calls', async () => {
    session.selectChild('child-1');
    void firstValueFrom(api.get('/family/kid/home'));
    const kid = await expectOne('/api/v1/family/kid/home');
    expect(kid.request.headers.get('X-Child-Id')).toBe('child-1');
    kid.flush(ok({}));
    void firstValueFrom(api.get('/family/me'));
    const me = await expectOne('/api/v1/family/me');
    expect(me.request.headers.has('X-Child-Id')).toBe(false);
    me.flush(ok({}));
  });

  it('sends the parent grant, slides it from the response, and drops it on PIN_REQUIRED', async () => {
    session.setParentGrant('grant-1', 900);
    void firstValueFrom(api.get('/family/parent/settings'));
    const first = await expectOne('/api/v1/family/parent/settings');
    expect(first.request.headers.get('X-Parent-Grant')).toBe('grant-1');
    first.flush(ok({}), { headers: { 'X-Parent-Grant': 'grant-2' } });
    expect(session.parentGrant()).toBe('grant-2');

    const denied = firstValueFrom(api.get('/family/parent/settings'));
    (await expectOne('/api/v1/family/parent/settings')).flush(fail('PIN_REQUIRED'), {
      status: 401,
      statusText: 'Unauthorized',
    });
    await expect(denied).rejects.toMatchObject({ code: 'PIN_REQUIRED' });
    expect(session.parentGrant()).toBeNull();
    expect(auth.refreshes).toBe(0);
  });

  it('never sends the token or family headers to other origins', async () => {
    session.selectChild('child-1');
    void firstValueFrom(TestBed.inject(HttpClient).get('https://cdn.example/family/kid/x'));
    await vi.advanceTimersByTimeAsync(0);
    const req = http.expectOne('https://cdn.example/family/kid/x');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.headers.has('X-Child-Id')).toBe(false);
    req.flush({});
  });

  it('FamilyApi.loadMe turns FAMILY_NOT_FOUND into a new family', async () => {
    const family = TestBed.inject(FamilyApi);
    const state = firstValueFrom(family.loadMe());
    (await expectOne('/api/v1/family/me')).flush(fail('FAMILY_NOT_FOUND'), {
      status: 404,
      statusText: 'Not found',
    });
    await expect(state).resolves.toBe('new');
    expect(family.state()).toBe('new');
  });

  it('FamilyApi: the first PIN unlocks parent mode; a PIN check is never replayed', async () => {
    const family = TestBed.inject(FamilyApi);
    const first = firstValueFrom(family.setFirstPin('1234'));
    (await expectOne('/api/v1/family/pin')).flush(
      ok({ pin_set: true, parent_grant: 'grant-b1', expires_in: 900 }),
    );
    await first;
    expect(session.parentGrant()).toBe('grant-b1');

    session.lockParent();
    const verify = firstValueFrom(family.verifyPin('1234'));
    const req = await expectOne('/api/v1/family/pin/verify');
    expect(req.request.headers.has('Idempotency-Key')).toBe(false);
    req.flush(ok({ parent_grant: 'grant-p0', expires_in: 900 }));
    await verify;
    expect(session.parentGrant()).toBe('grant-p0');
  });

  it('FamilyApi keeps /family/me in step with child moves, removals and the deletion request', async () => {
    const family = TestBed.inject(FamilyApi);
    const child = (id: string, classLevel: number) => ({
      id,
      first_name: id,
      age: 8,
      class_level: classLevel,
      avatar_key: 'cat',
      stars_total: 4,
    });
    const loaded = firstValueFrom(family.loadMe());
    (await expectOne('/api/v1/family/me')).flush(
      ok({
        family: {
          id: 'f1',
          consent_version: 'v1',
          daily_limit_minutes: 30,
          sound_enabled: true,
          celebrations_enabled: true,
          pin_set: true,
          deletion_requested_at: null,
        },
        children: [child('a', 3), child('b', 2)],
      }),
    );
    await loaded;

    const moved = firstValueFrom(family.moveToNextClass('a'));
    const move = await expectOne('/api/v1/family/parent/children/a/move-to-next-class');
    expect(move.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    move.flush(ok({ ...child('a', 4), stars_total: 0 }));
    await moved;

    const removed = firstValueFrom(family.removeChild('b'));
    (await expectOne('/api/v1/family/parent/children/b')).flush(ok({ id: 'b' }));
    await removed;

    const requested = firstValueFrom(family.requestDeletion());
    (await expectOne('/api/v1/family/parent/deletion-request')).flush(
      ok({ requested_at: '2026-10-21T06:00:00Z', due_by: '2026-11-20T06:00:00Z' }),
    );
    await requested;

    expect(family.me()?.children.map((c) => [c.id, c.class_level, c.stars_total])).toEqual([
      ['a', 4, 0],
    ]);
    expect(family.me()?.family.deletion_requested_at).toBe('2026-10-21T06:00:00Z');
  });
});
