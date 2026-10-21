import { HttpErrorResponse } from '@angular/common/http';

/** Schema §10 error codes, plus the client's own for network and malformed responses. */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'PIN_REQUIRED',
  'RECENT_LOGIN_REQUIRED',
  'FORBIDDEN',
  'CHILD_NOT_IN_FAMILY',
  'ROLE_MISMATCH',
  'NOT_FOUND',
  'FAMILY_NOT_FOUND',
  'CONFLICT',
  'MAX_CHILDREN',
  'BOOK_EXISTS',
  'CHECK_NOT_PASSED',
  'MAX_CLASS',
  'BOOK_MISMATCH',
  'VERSION_IMMUTABLE',
  'UPLOAD_LIMIT',
  'PIN_LOCKED',
  'RATE_LIMITED',
  'READING_LIMIT',
  'INTERNAL_ERROR',
  'DEPENDENCY_UNAVAILABLE',
  'FEATURE_DISABLED',
  /** No response: offline, DNS, connection refused, or the request was blocked. */
  'NETWORK',
  /** A response that is not the { status, data, error } envelope. */
  'INVALID_RESPONSE',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const KNOWN = new Set<string>(API_ERROR_CODES);

/** A failed API call, from the envelope's error part (Schema §10). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    /** Field name to code, e.g. { first_name: "REQUIRED" }. */
    readonly fields: Readonly<Record<string, string>> = {},
    /** Seconds to wait, for 423 PIN_LOCKED and 429. */
    readonly retryAfterS: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface EnvelopeError {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly fields?: unknown;
  readonly retry_after_s?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** Returns data from a success envelope; anything else is INVALID_RESPONSE. */
export function parseEnvelope<T>(body: unknown, status = 200): T {
  if (isRecord(body) && body['status'] === 'success' && 'data' in body) {
    return body['data'] as T;
  }
  throw new ApiError(status, 'INVALID_RESPONSE', 'The response was not in the expected format');
}

/** Any error from an HTTP call, as an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (!(error instanceof HttpErrorResponse)) {
    return new ApiError(0, 'INVALID_RESPONSE', 'Unexpected error');
  }
  if (error.status === 0) {
    return new ApiError(0, 'NETWORK', 'No connection');
  }
  const body: unknown = error.error;
  if (isRecord(body) && body['status'] === 'error' && isRecord(body['error'])) {
    const part = body['error'] as EnvelopeError;
    const code = typeof part.code === 'string' && KNOWN.has(part.code) ? part.code : null;
    return new ApiError(
      error.status,
      (code as ApiErrorCode | null) ?? fallbackCode(error.status),
      typeof part.message === 'string' ? part.message : '',
      stringMap(part.fields),
      typeof part.retry_after_s === 'number' ? part.retry_after_s : null,
    );
  }
  return new ApiError(error.status, fallbackCode(error.status), error.statusText);
}

/** For responses without an envelope, e.g. from the proxy. */
function fallbackCode(status: number): ApiErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    case 502:
    case 503:
    case 504:
      return 'DEPENDENCY_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_RESPONSE';
  }
}
