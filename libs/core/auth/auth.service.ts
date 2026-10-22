import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import Keycloak, { KeycloakLoginOptions } from 'keycloak-js';
import { DeviceCopy } from '../api/device-copy';
import { DeviceFamily } from '../family/device-family';
import { AUTH_CONFIG } from './auth-config';
import { TokenStore } from './token-store';

/** Seconds of validity a token must still have before a call; refreshed otherwise. */
const MIN_VALIDITY_S = 30;

/** Created per app so tests can supply a fake. */
export const KEYCLOAK_FACTORY = new InjectionToken<() => Keycloak>('KEYCLOAK_FACTORY', {
  providedIn: 'root',
  factory: () => {
    const config = inject(AUTH_CONFIG);
    return () => new Keycloak({ url: config.url, realm: config.realm, clientId: config.clientId });
  },
});

export interface SignInOptions {
  /** Prefills the email on the Keycloak page. */
  readonly email?: string;
  /** Forces a new email code, e.g. Forgot PIN (Schema §8.2: fresh login). */
  readonly fresh?: boolean;
}

export interface UserInfo {
  readonly subject: string;
  readonly email: string | null;
  /** Seconds since epoch of the last real sign-in (auth_time claim). */
  readonly authTime: number | null;
}

/**
 * Sign-in with Keycloak (Authorization Code + PKCE S256, Schema §8). Tokens stay in memory;
 * with persist on, the refresh token is also kept in IndexedDB and rotated on every refresh.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly config = inject(AUTH_CONFIG);
  private readonly store = inject(TokenStore);
  private readonly document = inject(DOCUMENT);
  private readonly keycloak = inject(KEYCLOAK_FACTORY)();
  private readonly deviceFamily = inject(DeviceFamily);
  private readonly deviceCopy = inject(DeviceCopy);

  private readonly signedIn = signal(false);
  private readonly claims = signal<UserInfo | null>(null);

  readonly authenticated = this.signedIn.asReadonly();
  readonly user = computed(() => (this.signedIn() ? this.claims() : null));

  /** Runs before the first navigation: finishes a sign-in redirect or restores a stored session. */
  async init(): Promise<void> {
    this.keycloak.onAuthSuccess = () => void this.saved();
    this.keycloak.onAuthRefreshSuccess = () => void this.saved();
    this.keycloak.onAuthLogout = () => void this.ended();
    this.keycloak.onAuthRefreshError = () => void this.ended();

    const stored = this.config.persist ? await this.store.read() : null;
    try {
      await this.keycloak.init({
        pkceMethod: 'S256',
        checkLoginIframe: false,
        responseMode: 'fragment',
        scope: this.config.scope,
        ...(stored ?? {}),
      });
    } catch {
      // A stored session that can no longer refresh: start signed out
      await this.ended();
    }
    this.update();
  }

  async signIn(options: SignInOptions = {}): Promise<void> {
    const login: KeycloakLoginOptions = {
      redirectUri: this.absolute(this.config.redirectPath),
      scope: this.config.scope,
      ...(options.email ? { loginHint: options.email } : {}),
      ...(options.fresh ? { prompt: 'login', maxAge: 0 } : {}),
    };
    await this.keycloak.login(login);
  }

  /** Revokes the refresh token (an offline token outlives the browser session), then signs out. */
  async signOut(): Promise<void> {
    const refreshToken = this.keycloak.refreshToken;
    if (refreshToken) {
      try {
        await fetch(this.endpoint('revoke'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.config.clientId,
            token: refreshToken,
            token_type_hint: 'refresh_token',
          }),
        });
      } catch {
        // Offline: the token still expires; the local session is cleared below
      }
    }
    await this.store.clear();
    // Plan 7.5: a real sign-out leaves nothing of the family on the device
    this.deviceFamily.clear();
    await this.deviceCopy.clear();
    this.signedIn.set(false);
    await this.keycloak.logout({ redirectUri: this.absolute(this.config.signedOutPath) });
  }

  /** A valid access token, refreshed when it is about to expire; null when signed out. */
  async token(): Promise<string | null> {
    if (!this.keycloak.authenticated) {
      return null;
    }
    try {
      await this.keycloak.updateToken(MIN_VALIDITY_S);
      return this.keycloak.token ?? null;
    } catch {
      await this.ended();
      return null;
    }
  }

  /** After the API answered 401: refresh now; false means the session is over. */
  async refreshNow(): Promise<boolean> {
    if (!this.keycloak.authenticated) {
      return false;
    }
    try {
      await this.keycloak.updateToken(-1);
      return true;
    } catch {
      await this.ended();
      return false;
    }
  }

  private async saved(): Promise<void> {
    this.update();
    const { token, refreshToken, idToken } = this.keycloak;
    if (this.config.persist && token && refreshToken) {
      await this.store.write({ token, refreshToken, ...(idToken ? { idToken } : {}) });
    }
  }

  private async ended(): Promise<void> {
    this.keycloak.clearToken();
    await this.store.clear();
    this.update();
  }

  private update(): void {
    const parsed = this.keycloak.tokenParsed;
    const authenticated = !!this.keycloak.authenticated && !!parsed?.sub;
    this.signedIn.set(authenticated);
    this.claims.set(
      authenticated && parsed?.sub
        ? {
            subject: parsed.sub,
            email: typeof parsed['email'] === 'string' ? parsed['email'] : null,
            authTime: typeof parsed['auth_time'] === 'number' ? parsed['auth_time'] : null,
          }
        : null,
    );
  }

  private endpoint(name: 'revoke'): string {
    return `${this.config.url}/realms/${encodeURIComponent(this.config.realm)}/protocol/openid-connect/${name}`;
  }

  /** An absolute URL under the app's base href (Keycloak needs absolute redirect URIs). */
  private absolute(path: string): string {
    return new URL(path.replace(/^\//, ''), this.document.baseURI).toString();
  }
}
