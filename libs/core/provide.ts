import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { API_INTERCEPTORS } from './api/interceptors';
import { AUTH_CONFIG, AuthConfig } from './auth/auth-config';
import { AuthService } from './auth/auth.service';

/** HTTP with the API interceptors, the auth config, and sign-in restored before routing. */
export function provideFullstarCore(config: AuthConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: AUTH_CONFIG, useValue: config },
    provideHttpClient(withInterceptors(API_INTERCEPTORS)),
    provideAppInitializer(() => inject(AuthService).init()),
  ]);
}
