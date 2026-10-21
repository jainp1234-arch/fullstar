import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { FamilyApi } from '../family/family-api';
import { StudioApi } from '../studio/studio-api';
import { AUTH_CONFIG } from './auth-config';
import { AuthService } from './auth.service';

/** UX only: the API checks every call (Schema §9). Signed out → the sign-in screen. */
export const signedInGuard: CanActivateFn = (): boolean | UrlTree => {
  if (inject(AuthService).authenticated()) {
    return true;
  }
  return inject(Router).parseUrl(inject(AUTH_CONFIG).signedOutPath);
};

/** Signed in already → skip the welcome screen. */
export function signedOutGuard(signedInPath: string): CanActivateFn {
  return () => (inject(AuthService).authenticated() ? inject(Router).parseUrl(signedInPath) : true);
}

/**
 * Family screens need a family: no family yet → consent (App Flow A2). Errors other than
 * FAMILY_NOT_FOUND let the screen load and show its own error.
 */
export function familyGuard(consentPath: string): CanActivateFn {
  return (): boolean | UrlTree | Observable<boolean | UrlTree> => {
    const router = inject(Router);
    if (!inject(AuthService).authenticated()) {
      return router.parseUrl(inject(AUTH_CONFIG).signedOutPath);
    }
    const family = inject(FamilyApi);
    const known = family.state();
    if (known && known !== 'new') {
      return true;
    }
    return family.loadMe().pipe(
      map((state) => (state === 'new' ? router.parseUrl(consentPath) : true)),
      catchError(() => of(true)),
    );
  };
}

/** Studio screens need an active staff row (Schema §8.3); 403 → back to staff sign-in. */
export const staffGuard: CanActivateFn = (): boolean | UrlTree | Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const signedOut = inject(AUTH_CONFIG).signedOutPath;
  if (!inject(AuthService).authenticated()) {
    return router.parseUrl(signedOut);
  }
  const studio = inject(StudioApi);
  if (studio.me()) {
    return true;
  }
  return studio.loadMe().pipe(
    map(() => true),
    catchError(() => of(router.parseUrl(`${signedOut}?denied=1`))),
  );
};
