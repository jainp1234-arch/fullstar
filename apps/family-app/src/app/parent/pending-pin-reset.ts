/**
 * Forgot PIN (App Flow A4) leaves for Keycloak to prove the email again; this marks the tab so
 * the sign-in return (A3) comes back to A4. If storage is unavailable the parent lands on C1.
 */
const KEY = 'fullstar.pendingPinReset';

export function rememberPinReset(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Lands on C1 instead
  }
}

export function takePinReset(): boolean {
  try {
    const pending = sessionStorage.getItem(KEY) === '1';
    sessionStorage.removeItem(KEY);
    return pending;
  } catch {
    return false;
  }
}
