import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, retry, throwError, timer } from 'rxjs';
import { ApiError, parseEnvelope, toApiError } from './api-error';
import { API_BASE, IDEMPOTENCY_KEY } from './api-context';

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

export interface WriteOptions {
  /** Default true: sends an Idempotency-Key so a retried write runs once (Schema §10). */
  readonly idempotent?: boolean;
}

/** Retries for dropped connections and an unavailable dependency, with exponential backoff. */
const MAX_RETRIES = 2;
const BACKOFF_MS = 400;
const RETRYABLE = new Set([0, 502, 503, 504]);

/**
 * Typed calls to /api/v1 returning the envelope's data, or failing with ApiError. Headers for
 * the token, child, parent grant and idempotency key are added by the interceptors.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.call(
      this.http.get<unknown>(this.url(path), { params: clean(params), observe: 'response' }),
      true,
    );
  }

  post<T>(path: string, body: unknown, options?: WriteOptions): Observable<T> {
    const context = writeContext(options);
    return this.call(
      this.http.post<unknown>(this.url(path), body, { context, observe: 'response' }),
      !!context.get(IDEMPOTENCY_KEY),
    );
  }

  put<T>(path: string, body: unknown, options?: WriteOptions): Observable<T> {
    const context = writeContext(options);
    return this.call(
      this.http.put<unknown>(this.url(path), body, { context, observe: 'response' }),
      !!context.get(IDEMPOTENCY_KEY),
    );
  }

  patch<T>(path: string, body: unknown, options?: WriteOptions): Observable<T> {
    const context = writeContext(options);
    return this.call(
      this.http.patch<unknown>(this.url(path), body, { context, observe: 'response' }),
      !!context.get(IDEMPOTENCY_KEY),
    );
  }

  delete<T>(path: string, options?: WriteOptions): Observable<T> {
    const context = writeContext(options);
    return this.call(
      this.http.delete<unknown>(this.url(path), { context, observe: 'response' }),
      !!context.get(IDEMPOTENCY_KEY),
    );
  }

  private url(path: string): string {
    if (!path.startsWith('/') || path.includes('..') || /^\/\//.test(path)) {
      throw new ApiError(0, 'INVALID_RESPONSE', `Bad API path: ${path}`);
    }
    return `${API_BASE}${path}`;
  }

  private call<T>(
    request: Observable<{ status: number; body: unknown }>,
    retryable: boolean,
  ): Observable<T> {
    return request.pipe(
      retry({
        count: retryable ? MAX_RETRIES : 0,
        delay: (error: unknown, attempt) =>
          error instanceof HttpErrorResponse && RETRYABLE.has(error.status)
            ? timer(BACKOFF_MS * 2 ** (attempt - 1))
            : throwError(() => error),
      }),
      map((response) => parseEnvelope<T>(response.body, response.status)),
      catchError((error: unknown) => throwError(() => toApiError(error))),
    );
  }
}

function writeContext(options?: WriteOptions): HttpContext {
  const context = new HttpContext();
  if (options?.idempotent !== false) {
    context.set(IDEMPOTENCY_KEY, crypto.randomUUID());
  }
  return context;
}

function clean(params?: QueryParams): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params ?? {}).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
    ),
  );
}
