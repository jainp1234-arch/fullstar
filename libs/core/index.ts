/*
 * Public API of @fullstar/core: sign-in, the typed API client and family/staff session state.
 * No UI here (Guidelines §18); components live in @fullstar/ui.
 */

export * from './api/api-context';
export * from './api/api-error';
export * from './api/api-client';
export * from './api/interceptors';
export * from './auth/auth-config';
export * from './auth/auth.service';
export * from './auth/token-store';
export * from './auth/guards';
export * from './family/family-session';
export * from './family/family-api';
export * from './studio/studio-api';
export * from './studio/content-api';
export * from './provide';
export * from './family/book-api';
