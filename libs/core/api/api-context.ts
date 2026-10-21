import { HttpContextToken } from '@angular/common/http';

/** Relative, so it goes through the same origin as the app (Caddy routes /api/). */
export const API_BASE = '/api/v1';

/** Set once per logical call by ApiClient, so retries send the same key (Schema §10). */
export const IDEMPOTENCY_KEY = new HttpContextToken<string | null>(() => null);

/** True for calls the interceptors may retry once after refreshing the token. */
export const AUTH_RETRIED = new HttpContextToken<boolean>(() => false);

/** Only calls to our API get the token and family headers, never other origins. */
export function isApiUrl(url: string): boolean {
  return url === API_BASE || url.startsWith(`${API_BASE}/`);
}
