import { InjectionToken } from '@angular/core';

export interface AuthConfig {
  /** Keycloak base URL; same origin through Caddy (/auth). */
  readonly url: string;
  readonly realm: string;
  /** Public PKCE client (Schema §8): family-app or content-studio. */
  readonly clientId: string;
  /** Scopes for login; the family app asks for offline_access (30-day refresh token). */
  readonly scope: string;
  /** Keep the refresh token in IndexedDB so the installed PWA stays signed in (Schema §8.1). */
  readonly persist: boolean;
  /** Where Keycloak sends the browser back after sign-in, relative to the base href. */
  readonly redirectPath: string;
  /** Where to go after sign-out or when the session ends, relative to the base href. */
  readonly signedOutPath: string;
}

export const AUTH_CONFIG = new InjectionToken<AuthConfig>('AUTH_CONFIG');
