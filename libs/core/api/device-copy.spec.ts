import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { AUTH_CONFIG, AuthConfig } from '../auth/auth-config';
import { AuthService } from '../auth/auth.service';
import { familyGuard } from '../auth/guards';
import { DeviceFamily } from '../family/device-family';
import { FamilyApi, FamilyMe } from '../family/family-api';
import { FamilySession } from '../family/family-session';
import { ApiClient } from './api-client';
import { DeviceCopy } from './device-copy';
import { API_INTERCEPTORS } from './interceptors';

const CONFIG: AuthConfig = {
  url: 'http://localhost/auth',
  realm: 'fullstar',
  clientId: 'family-app',
  scope: 'openid',
  persist: false,
  redirectPath: '/sign-in/code',
  signedOutPath: '/welcome',
  sessionEnded: { path: '/who', stayOn: ['/kid/', '/who'] },
};

const ME = {
  family: { id: 'fam-1', pin_set: true },
  children: [{ id: 'child-1', first_name: 'Asha', class_level: 3, avatar_key: 'cat' }],
} as unknown as FamilyMe;

/** A session that can no longer refresh once `ended` is set. */
class FakeAuth {
  ended = false;
  authenticated = () => !this.ended;
  token = async () => (this.ended ? null : 'token-1');
  refreshNow = async () => !this.ended;
}

/** Cache Storage stand-in: jsdom has none. */
class FakeCopy {
  readonly store = new Map<string, unknown>();
  read = async (key: string) => this.store.get(key);
  write = async (key: string, body: unknown) => void this.store.set(key, body);
  has = async () => false;
  clear = async () => this.store.clear();
}

function ok<T>(data: T) {
  return { status: 'success', data, error: null };
}

describe('device copy and an ended session (App Flow §10, §11; Plan 7.5)', () => {
  let http: HttpTestingController;
  let api: ApiClient;
  let auth: FakeAuth;
  let copy: FakeCopy;
  let router: Router;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    auth = new FakeAuth();
    copy = new FakeCopy();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(API_INTERCEPTORS)),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTH_CONFIG, useValue: CONFIG },
        { provide: AuthService, useValue: auth },
        { provide: DeviceCopy, useValue: copy },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(ApiClient);
    router = TestBed.inject(Router);
    TestBed.inject(FamilySession).selectChild('child-1');
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  async function expectOne(url: string) {
    await vi.advanceTimersByTimeAsync(0);
    return http.expectOne(url);
  }

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  it('keeps a kid answer per child and serves it when the API cannot be reached', async () => {
    const first = firstValueFrom(api.get('/family/kid/lessons/l-1'));
    (await expectOne('/api/v1/family/kid/lessons/l-1')).flush(ok({ id: 'l-1' }));
    await expect(first).resolves.toEqual({ id: 'l-1' });
    await settle();
    expect([...copy.store.keys()]).toEqual([
      'https://device.invalid/child-1/family/kid/lessons/l-1',
    ]);

    const offline = firstValueFrom(api.get('/family/kid/lessons/l-1'));
    (await expectOne('/api/v1/family/kid/lessons/l-1')).error(new ProgressEvent('error'));
    await expect(offline).resolves.toEqual({ id: 'l-1' });
  });

  it('keeps only screens that work offline; others fail as before', async () => {
    const set = firstValueFrom(api.post('/family/kid/practice-sets', { kind: 'practice' }));
    (await expectOne('/api/v1/family/kid/practice-sets')).flush(ok({ questions: [] }));
    await set;
    const settings = firstValueFrom(api.get('/family/parent/settings'));
    (await expectOne('/api/v1/family/parent/settings')).flush(ok({}));
    await settings;
    await settle();
    expect(copy.store.size).toBe(0);

    const missing = firstValueFrom(api.get('/family/kid/lessons/never-opened'));
    const failed = expect(missing).rejects.toMatchObject({ code: 'NETWORK' });
    // ApiClient retries a network error twice with backoff (400 ms, 800 ms)
    for (let attempt = 0; attempt < 3; attempt++) {
      (await expectOne('/api/v1/family/kid/lessons/never-opened')).error(
        new ProgressEvent('error'),
      );
      await vi.advanceTimersByTimeAsync(1000);
    }
    await failed;
  });

  it('an ended session keeps a child in kid mode on the device copy', async () => {
    TestBed.inject(DeviceFamily).save(ME);
    copy.store.set('https://device.invalid/child-1/family/kid/home', ok({ stars: 4 }));
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/kid/learn');
    auth.ended = true;

    const home = firstValueFrom(api.get('/family/kid/home'));
    (await expectOne('/api/v1/family/kid/home')).flush(
      { status: 'error', data: null, error: { code: 'UNAUTHENTICATED', message: 'x' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    await expect(home).resolves.toEqual({ stars: 4 });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('an ended session goes to Who is learning? when the device knows the family, else Welcome', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/parent/settings');
    auth.ended = true;
    const unauthorized = { status: 401, statusText: 'Unauthorized' };
    const body = { status: 'error', data: null, error: { code: 'UNAUTHENTICATED', message: 'x' } };

    const noFamily = firstValueFrom(api.get('/family/parent/settings'));
    (await expectOne('/api/v1/family/parent/settings')).flush(body, unauthorized);
    await expect(noFamily).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(navigate).toHaveBeenLastCalledWith('/welcome');

    TestBed.inject(DeviceFamily).save(ME);
    const known = firstValueFrom(api.get('/family/parent/settings'));
    (await expectOne('/api/v1/family/parent/settings')).flush(body, unauthorized);
    await expect(known).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(navigate).toHaveBeenLastCalledWith('/who');
  });

  it('familyGuard lets an ended session in with the family this device saw', async () => {
    auth.ended = true;
    const run = async () => {
      const result = TestBed.runInInjectionContext(() =>
        familyGuard('/sign-up')({} as never, {} as never),
      );
      const value = isObservable(result)
        ? await firstValueFrom(result as Observable<unknown>)
        : result;
      return value instanceof UrlTree ? router.serializeUrl(value) : value;
    };
    expect(await run()).toBe('/welcome');
    TestBed.inject(DeviceFamily).save(ME);
    expect(await run()).toBe(true);
    expect(TestBed.inject(FamilyApi).me()?.children[0].first_name).toBe('Asha');
  });
});
