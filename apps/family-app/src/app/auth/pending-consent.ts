/**
 * The consent version a parent accepted before going to Keycloak to sign up (App Flow A2), kept
 * in this tab across the redirect. If storage is unavailable the consent screen simply asks again.
 */
const KEY = 'fullstar.pendingConsent';

export function rememberConsent(version: string): void {
  try {
    sessionStorage.setItem(KEY, version);
  } catch {
    // Asked again after sign-in
  }
}

export function takeConsent(): string | null {
  try {
    const version = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return version;
  } catch {
    return null;
  }
}
