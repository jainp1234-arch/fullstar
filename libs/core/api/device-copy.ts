import {
  HttpErrorResponse,
  HttpEvent,
  HttpHeaders,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, of, switchMap, tap, throwError } from 'rxjs';
import { FamilySession } from '../family/family-session';
import { API_BASE, CHILD_ID } from './api-context';
import { toApiError } from './api-error';

const CACHE = 'fullstar-device-copy';

/** Header on a response served from the device copy. */
export const FROM_DEVICE_HEADER = 'X-From-Device';

/**
 * What works offline (App Flow §11, Plan 7.5): kid screens K1–K3, lessons and the on-screen
 * worksheet, and P1's last saved week. Reads only, or a POST that only reads (K6 on screen).
 */
const KEPT: readonly { method: string; path: RegExp }[] = [
  {
    method: 'GET',
    path: /^\/family\/kid\/(home|practice|subjects\/\d+|chapters\/[^/]+|topics\/[^/]+|lessons\/[^/]+)$/,
  },
  { method: 'POST', path: /^\/family\/kid\/worksheets\/[^/]+\/onscreen$/ },
  { method: 'GET', path: /^\/family\/parent\/children\/[^/]+\/(week|subjects\/\d+)$/ },
];

/**
 * The device copy of those answers, in Cache Storage under the child and the request (Plan 7.5).
 * Network first; the copy is used when the API can't be reached or the session has ended.
 */
@Injectable({ providedIn: 'root' })
export class DeviceCopy {
  async read(key: string): Promise<unknown> {
    try {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(key);
      return hit ? ((await hit.json()) as unknown) : undefined;
    } catch {
      return undefined;
    }
  }

  async write(key: string, body: unknown): Promise<void> {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(
        key,
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
      );
    } catch {
      // No Cache Storage (private window, insecure origin): online only
    }
  }

  /** Whether the device has a copy of this API call for the child (K1–K3 offline cards). */
  async has(method: 'GET' | 'POST', path: string, childId: string | null): Promise<boolean> {
    const key = deviceKey(method, path, '', childId);
    if (!key) {
      return false;
    }
    try {
      return (await (await caches.open(CACHE)).match(key)) !== undefined;
    } catch {
      return false;
    }
  }

  /** Sign-out: nothing of the family stays on the device. */
  async clear(): Promise<void> {
    try {
      await caches.delete(CACHE);
    } catch {
      // Nothing stored
    }
  }
}

/** The cache key of a kept call (path under /api/v1), or null when it is not kept. */
function deviceKey(
  method: string,
  path: string,
  search: string,
  childId: string | null,
): string | null {
  if (!KEPT.some((rule) => rule.method === method && rule.path.test(path))) {
    return null;
  }
  return `https://device.invalid/${encodeURIComponent(childId ?? '-')}${path}${search}`;
}

function keyFor(req: HttpRequest<unknown>, childId: string | null): string | null {
  const url = new URL(req.urlWithParams, 'https://device.invalid');
  if (!url.pathname.startsWith(API_BASE)) {
    return null;
  }
  return deviceKey(req.method, url.pathname.slice(API_BASE.length), url.search, childId);
}

/** The API could not be reached, or the session is over (App Flow §10). */
function unreachable(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) {
    return false;
  }
  return error.status === 0 || toApiError(error).code === 'UNAUTHENTICATED';
}

/** Outermost: keeps good answers, and answers from the copy when the API is out of reach. */
export const deviceCopyInterceptor: HttpInterceptorFn = (req, next) => {
  const key = keyFor(req, req.context.get(CHILD_ID) ?? inject(FamilySession).activeChildId());
  if (!key) {
    return next(req);
  }
  const copy = inject(DeviceCopy);
  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse && event.ok) {
        void copy.write(key, event.body);
      }
    }),
    catchError((error: unknown): Observable<HttpEvent<unknown>> => {
      if (!unreachable(error)) {
        return throwError(() => error);
      }
      return from(copy.read(key)).pipe(
        switchMap((body) =>
          body === undefined
            ? throwError(() => error)
            : of(
                new HttpResponse({
                  status: 200,
                  body,
                  url: req.urlWithParams,
                  headers: new HttpHeaders({ [FROM_DEVICE_HEADER]: '1' }),
                }),
              ),
        ),
      );
    }),
  );
};
