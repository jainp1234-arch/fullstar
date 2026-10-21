import { DisplayMode } from '../mode/display-mode';
import { EN } from './en';

/**
 * Message for an API error code (Schema §10) in the screen's voice (Guidelines §15–§16).
 * Kid mode never shows "error" or blame: most failures are "Let's try again.".
 * Codes are typed as strings so this file does not depend on @fullstar/core.
 */
export function errorMessage(code: string, mode: DisplayMode, retryAfterS?: number | null): string {
  if (mode === 'kid') {
    return kidMessage(code);
  }
  const parent = EN.errors.parent;
  switch (code) {
    case 'NETWORK':
      return EN.parent.offline;
    case 'UNAUTHENTICATED':
      return parent.signInAgain;
    case 'PIN_REQUIRED':
      return parent.pinRequired;
    case 'PIN_LOCKED':
      return parent.pinLocked(minutes(retryAfterS));
    case 'RECENT_LOGIN_REQUIRED':
      return parent.recentLogin;
    case 'FORBIDDEN':
    case 'CHILD_NOT_IN_FAMILY':
    case 'ROLE_MISMATCH':
      return parent.forbidden;
    case 'NOT_FOUND':
      return parent.notFound;
    case 'FAMILY_NOT_FOUND':
      return parent.familyNotFound;
    case 'VALIDATION_FAILED':
      return parent.validation;
    case 'CONFLICT':
      return parent.conflict;
    case 'MAX_CHILDREN':
      return parent.maxChildren;
    case 'BOOK_EXISTS':
      return parent.bookExists;
    case 'CHECK_NOT_PASSED':
      return parent.checkNotPassed;
    case 'MAX_CLASS':
      return parent.maxClass;
    case 'BOOK_MISMATCH':
      return parent.bookMismatch;
    case 'VERSION_IMMUTABLE':
      return parent.versionImmutable;
    case 'UPLOAD_LIMIT':
      return parent.uploadLimit;
    case 'RATE_LIMITED':
      return parent.rateLimited;
    case 'READING_LIMIT':
      return parent.readingLimit;
    case 'FEATURE_DISABLED':
      return parent.featureDisabled;
    default:
      return EN.parent.somethingFailed;
  }
}

function kidMessage(code: string): string {
  switch (code) {
    case 'NETWORK':
      return EN.kid.offline;
    case 'UNAUTHENTICATED':
    case 'FORBIDDEN':
    case 'CHILD_NOT_IN_FAMILY':
    case 'PIN_REQUIRED':
      return EN.kid.needsParent;
    case 'READING_LIMIT':
      return EN.errors.kid.readingLimit;
    default:
      return EN.kid.somethingFailed;
  }
}

/** Message for a field code from VALIDATION_FAILED (e.g. { first_name: "REQUIRED" }). */
export function fieldMessage(code: string): string {
  const fields = EN.errors.fields;
  switch (code) {
    case 'REQUIRED':
      return fields.required;
    case 'INVALID_LENGTH':
      return fields.length;
    case 'OUT_OF_RANGE':
      return fields.range;
    case 'WRONG':
      return fields.wrongPin;
    default:
      return fields.invalid;
  }
}

function minutes(seconds?: number | null): number {
  return Math.max(1, Math.ceil((seconds ?? 60) / 60));
}
