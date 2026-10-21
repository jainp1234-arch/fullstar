import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideFullstarCore } from '@fullstar/core';
import { SCREEN_CONFIG } from '@fullstar/ui';
import { routes } from './app.routes';
import { FAMILY_SCREENS } from './screens';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: SCREEN_CONFIG, useValue: FAMILY_SCREENS },
    // Schema §8.1: public PKCE client; Keycloak and the API share the app's origin through Caddy
    provideFullstarCore({
      url: `${window.location.origin}/auth`,
      realm: 'fullstar',
      clientId: 'family-app',
      scope: 'openid email offline_access',
      persist: true,
      redirectPath: '/sign-in/code',
      signedOutPath: '/welcome',
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
