import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { FamilyApi, FamilyState } from '../family/family-api';
import { FamilySession } from '../family/family-session';
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

/** Where an unfinished setup continues (App Flow §4): no PIN → B1, no child yet → B2. */
export interface SetupPaths {
  readonly pin: string;
  readonly child: string;
}

/**
 * Family screens need a family: no family yet → consent (App Flow A2). With setup paths, the
 * family must also have finished setup. Errors other than FAMILY_NOT_FOUND let the screen load
 * and show its own error.
 */
export function familyGuard(consentPath: string, setup?: SetupPaths): CanActivateFn {
  return (): boolean | UrlTree | Observable<boolean | UrlTree> => {
    const router = inject(Router);
    if (!inject(AuthService).authenticated()) {
      return router.parseUrl(inject(AUTH_CONFIG).signedOutPath);
    }
    const family = inject(FamilyApi);
    const decide = (state: FamilyState): boolean | UrlTree => {
      if (state === 'new') {
        return router.parseUrl(consentPath);
      }
      if (!setup || !state) {
        return true;
      }
      if (!state.family.pin_set) {
        return router.parseUrl(setup.pin);
      }
      return state.children.length ? true : router.parseUrl(setup.child);
    };
    const known = family.state();
    if (known && known !== 'new') {
      return decide(known);
    }
    return family.loadMe().pipe(
      map(decide),
      catchError(() => of(true)),
    );
  };
}

/**
 * Parent mode needs a parent grant (Schema §8.2): without one → the PIN screen, which returns
 * to the requested URL. UX only: the API answers 401 PIN_REQUIRED anyway.
 */
export function parentGuard(pinPath: string): CanActivateFn {
  return (_route, state): boolean | UrlTree => {
    if (inject(FamilySession).parentGrant()) {
      return true;
    }
    return inject(Router).createUrlTree([pinPath], { queryParams: { next: state.url } });
  };
}

/** Kid mode needs the child picked on Who is learning? (X-Child-Id); otherwise → C1. */
export function kidGuard(whoPath: string): CanActivateFn {
  return (): boolean | UrlTree => {
    const childId = inject(FamilySession).activeChildId();
    const me = inject(FamilyApi).me();
    if (childId && (!me || me.children.some((child) => child.id === childId))) {
      return true;
    }
    return inject(Router).parseUrl(whoPath);
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

/** Super-admin screens (S13): run after staffGuard; anyone else goes to the given path. */
export function superAdminGuard(otherwisePath: string): CanActivateFn {
  return (): boolean | UrlTree =>
    inject(StudioApi).me()?.role === 'super_admin' ? true : inject(Router).parseUrl(otherwisePath);
}
