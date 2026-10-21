import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import type Keycloak from 'keycloak-js';
import { Observable, firstValueFrom, isObservable, of, throwError } from 'rxjs';
import { ApiError } from '../api/api-error';
import { FamilyApi, FamilyState } from '../family/family-api';
import { FamilySession } from '../family/family-session';
import { AUTH_CONFIG, AuthConfig } from './auth-config';
import { AuthService, KEYCLOAK_FACTORY } from './auth.service';
import { familyGuard, kidGuard, parentGuard, signedInGuard, signedOutGuard } from './guards';
import { StoredTokens, TokenStore } from './token-store';

const CONFIG: AuthConfig = {
  url: 'http://localhost/auth',
  realm: 'fullstar',
  clientId: 'family-app',
  scope: 'openid email offline_access',
  persist: true,
  redirectPath: '/sign-in/code',
  signedOutPath: '/welcome',
};

/** Just enough of keycloak-js for AuthService. */
class FakeKeycloak {
  authenticated = false;
  token?: string;
  refreshToken?: string;
  idToken?: string;
  tokenParsed?: Record<string, unknown>;
  onAuthSuccess?: () => void;
  onAuthRefreshSuccess?: () => void;
  onAuthLogout?: () => void;
  onAuthRefreshError?: () => void;
  initOptions: Record<string, unknown> | null = null;
  loginOptions: Record<string, unknown> | null = null;
  logoutOptions: Record<string, unknown> | null = null;
  refreshFails = false;

  async init(options: Record<string, unknown>): Promise<boolean> {
    this.initOptions = options;
    if (options['refreshToken']) {
      this.signIn('restored');
      this.onAuthSuccess?.();
    }
    return this.authenticated;
  }

  signIn(name: string): void {
    this.authenticated = true;
    this.token = `access-${name}`;
    this.refreshToken = `refresh-${name}`;
    this.tokenParsed = { sub: 'user-1', email: 'parent@example.com', auth_time: 1700000000 };
  }

  async updateToken(): Promise<boolean> {
    if (this.refreshFails) {
      throw new Error('refresh failed');
    }
    this.signIn('rotated');
    this.onAuthRefreshSuccess?.();
    return true;
  }

  async login(options: Record<string, unknown>): Promise<void> {
    this.loginOptions = options;
  }

  async logout(options: Record<string, unknown>): Promise<void> {
    this.logoutOptions = options;
  }

  clearToken(): void {
    this.authenticated = false;
    this.token = undefined;
    this.refreshToken = undefined;
    this.tokenParsed = undefined;
  }
}

class MemoryStore {
  saved: StoredTokens | null = null;
  async read() {
    return this.saved;
  }
  async write(tokens: StoredTokens) {
    this.saved = tokens;
  }
  async clear() {
    this.saved = null;
  }
}

function setup(stored: StoredTokens | null = null) {
  const keycloak = new FakeKeycloak();
  const store = new MemoryStore();
  store.saved = stored;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AUTH_CONFIG, useValue: CONFIG },
      { provide: TokenStore, useValue: store },
      { provide: KEYCLOAK_FACTORY, useValue: () => keycloak as unknown as Keycloak },
    ],
  });
  return { keycloak, store, auth: TestBed.inject(AuthService) };
}

describe('AuthService', () => {
  it('starts signed out and initialises with PKCE S256 and no iframe', async () => {
    const { keycloak, auth } = setup();
    await auth.init();
    expect(keycloak.initOptions).toMatchObject({ pkceMethod: 'S256', checkLoginIframe: false });
    expect(auth.authenticated()).toBe(false);
    expect(await auth.token()).toBeNull();
  });

  it('restores a stored session and keeps the rotated refresh token', async () => {
    const { keycloak, store, auth } = setup({ token: 'old', refreshToken: 'refresh-old' });
    await auth.init();
    expect(keycloak.initOptions).toMatchObject({ refreshToken: 'refresh-old' });
    expect(auth.user()).toMatchObject({ subject: 'user-1', email: 'parent@example.com' });
    expect(await auth.token()).toBe('access-rotated');
    await Promise.resolve();
    expect(store.saved?.refreshToken).toBe('refresh-rotated');
  });

  it('signs in back to the A3 page and can force a fresh login', async () => {
    const { keycloak, auth } = setup();
    await auth.signIn({ email: 'parent@example.com', fresh: true });
    expect(keycloak.loginOptions).toMatchObject({
      redirectUri: 'http://localhost:3000/sign-in/code',
      loginHint: 'parent@example.com',
      prompt: 'login',
      maxAge: 0,
      scope: 'openid email offline_access',
    });
  });

  it('revokes the refresh token and clears storage on sign-out', async () => {
    const { keycloak, store, auth } = setup({ token: 'old', refreshToken: 'refresh-old' });
    await auth.init();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
    await auth.signOut();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      'http://localhost/auth/realms/fullstar/protocol/openid-connect/revoke',
    );
    expect(String((init as RequestInit).body)).toContain('token_type_hint=refresh_token');
    expect(store.saved).toBeNull();
    expect(keycloak.logoutOptions).toMatchObject({ redirectUri: 'http://localhost:3000/welcome' });
    expect(auth.authenticated()).toBe(false);
    fetchSpy.mockRestore();
  });

  it('ends the session when a refresh fails', async () => {
    const { keycloak, store, auth } = setup({ token: 'old', refreshToken: 'refresh-old' });
    await auth.init();
    keycloak.refreshFails = true;
    expect(await auth.refreshNow()).toBe(false);
    expect(auth.authenticated()).toBe(false);
    expect(store.saved).toBeNull();
  });
});

describe('guards', () => {
  async function run(guard: () => unknown): Promise<unknown> {
    const result = TestBed.runInInjectionContext(guard);
    return isObservable(result) ? firstValueFrom(result as Observable<unknown>) : result;
  }

  function serialize(result: unknown): string | boolean {
    return result instanceof UrlTree
      ? TestBed.inject(Router).serializeUrl(result)
      : (result as boolean);
  }

  it('signed out: sign-in screens only', async () => {
    const { auth } = setup();
    await auth.init();
    expect(serialize(await run(() => signedInGuard({} as never, {} as never)))).toBe('/welcome');
    expect(serialize(await run(() => signedOutGuard('/who')({} as never, {} as never)))).toBe(true);
  });

  it('a signed-in parent without a family goes to consent', async () => {
    const { auth } = setup({ token: 'old', refreshToken: 'refresh-old' });
    await auth.init();
    const family = TestBed.inject(FamilyApi);
    vi.spyOn(family, 'loadMe').mockReturnValue(of<FamilyState>('new'));
    expect(serialize(await run(() => familyGuard('/sign-up')({} as never, {} as never)))).toBe(
      '/sign-up',
    );
    expect(serialize(await run(() => signedOutGuard('/who')({} as never, {} as never)))).toBe(
      '/who',
    );
  });

  it('other API errors let the screen show its own message', async () => {
    const { auth } = setup({ token: 'old', refreshToken: 'refresh-old' });
    await auth.init();
    const family = TestBed.inject(FamilyApi);
    vi.spyOn(family, 'loadMe').mockReturnValue(
      throwError(() => new ApiError(0, 'NETWORK', 'offline')),
    );
    expect(await run(() => familyGuard('/sign-up')({} as never, {} as never))).toBe(true);
  });

  it('with setup paths, an unfinished setup continues at B1, then B2', async () => {
    const { auth } = setup({ token: 'old', refreshToken: 'refresh-old' });
    await auth.init();
    const family = TestBed.inject(FamilyApi);
    const load = vi.spyOn(family, 'loadMe');
    const setupPaths = { pin: '/setup/pin', child: '/setup/child' };
    const guard = () => familyGuard('/sign-up', setupPaths)({} as never, {} as never);

    load.mockReturnValue(of<FamilyState>(familyMe(false, 0)));
    expect(serialize(await run(guard))).toBe('/setup/pin');
    load.mockReturnValue(of<FamilyState>(familyMe(true, 0)));
    expect(serialize(await run(guard))).toBe('/setup/child');
    load.mockReturnValue(of<FamilyState>(familyMe(true, 1)));
    expect(serialize(await run(guard))).toBe(true);
  });

  it('parent screens need the grant, kid screens a child of this family', async () => {
    setup();
    const session = TestBed.inject(FamilySession);
    const state = { url: '/parent/settings' } as never;
    expect(serialize(await run(() => parentGuard('/parent/pin')({} as never, state)))).toBe(
      '/parent/pin?next=%2Fparent%2Fsettings',
    );
    session.setParentGrant('grant-1', 900);
    expect(await run(() => parentGuard('/parent/pin')({} as never, state))).toBe(true);

    expect(serialize(await run(() => kidGuard('/who')({} as never, {} as never)))).toBe('/who');
    session.selectChild('child-1');
    expect(await run(() => kidGuard('/who')({} as never, {} as never))).toBe(true);
  });
});

function familyMe(pinSet: boolean, children: number): FamilyState {
  return {
    family: {
      id: 'family-1',
      consent_version: 'v1',
      daily_limit_minutes: 30,
      sound_enabled: true,
      celebrations_enabled: true,
      pin_set: pinSet,
    },
    children: Array.from({ length: children }, (_, i) => ({
      id: `child-${i + 1}`,
      first_name: `Child ${i + 1}`,
      age: 8,
      class_level: 3,
      avatar_key: 'cat',
      stars_total: 0,
    })),
  };
}
