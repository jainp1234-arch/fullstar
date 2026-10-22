import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, from, switchMap, tap, throwError } from 'rxjs';
import { AUTH_CONFIG } from '../auth/auth-config';
import { AuthService } from '../auth/auth.service';
import { FamilySession } from '../family/family-session';
import { API_BASE, AUTH_RETRIED, CHILD_ID, IDEMPOTENCY_KEY, isApiUrl } from './api-context';
import { toApiError } from './api-error';

const KID_PREFIX = `${API_BASE}/family/kid/`;
const PARENT_PREFIX = `${API_BASE}/family/parent/`;
const GRANT_HEADER = 'X-Parent-Grant';

/** Bearer token on API calls; one refresh-and-retry on 401 UNAUTHENTICATED, then sign-in. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiUrl(req.url)) {
    return next(req);
  }
  const auth = inject(AuthService);
  const router = inject(Router);
  const config = inject(AUTH_CONFIG);
  const send = (request: HttpRequest<unknown>): Observable<HttpEvent<unknown>> =>
    from(auth.token()).pipe(
      switchMap((token) =>
        next(token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request),
      ),
    );
  return send(req).pipe(
    catchError((error: unknown) => {
      const unauthenticated =
        error instanceof HttpErrorResponse && toApiError(error).code === 'UNAUTHENTICATED';
      if (!unauthenticated || req.context.get(AUTH_RETRIED)) {
        return throwError(() => error);
      }
      return from(auth.refreshNow()).pipe(
        switchMap((refreshed) => {
          if (!refreshed) {
            void router.navigateByUrl(config.signedOutPath);
            return throwError(() => error);
          }
          return send(req.clone({ context: req.context.set(AUTH_RETRIED, true) }));
        }),
      );
    }),
  );
};

/** Kid-mode calls carry the child (Schema §8.2). */
export const childInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(KID_PREFIX)) {
    return next(req);
  }
  const childId = req.context.get(CHILD_ID) ?? inject(FamilySession).activeChildId();
  return next(childId ? req.clone({ setHeaders: { 'X-Child-Id': childId } }) : req);
};

/** Parent-mode calls carry the grant; responses slide it; PIN_REQUIRED drops it. */
export const parentGrantInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  if (!req.url.startsWith(PARENT_PREFIX)) {
    return next(req);
  }
  const session = inject(FamilySession);
  const grant = session.parentGrant();
  return next(grant ? req.clone({ setHeaders: { [GRANT_HEADER]: grant } }) : req).pipe(
    tap((event) => {
      const fresh = event instanceof HttpResponse ? event.headers.get(GRANT_HEADER) : null;
      if (fresh) {
        session.setParentGrant(fresh);
      }
    }),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && toApiError(error).code === 'PIN_REQUIRED') {
        session.lockParent();
      }
      return throwError(() => error);
    }),
  );
};

/** The key ApiClient chose for this write, the same on every retry (Schema §10). */
export const idempotencyInterceptor: HttpInterceptorFn = (req, next) => {
  const key = req.context.get(IDEMPOTENCY_KEY);
  if (!key || !isApiUrl(req.url) || req.method === 'GET') {
    return next(req);
  }
  return next(req.clone({ setHeaders: { 'Idempotency-Key': key } }));
};

/** In order: idempotency key, family headers, then the token (which may retry). */
export const API_INTERCEPTORS: HttpInterceptorFn[] = [
  idempotencyInterceptor,
  childInterceptor,
  parentGrantInterceptor,
  authInterceptor,
];
