import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withPreloading } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideFullstarCore } from '@fullstar/core';
import { KID_TIME, SCREEN_CONFIG } from '@fullstar/ui';
import { routes } from './app.routes';
import { IdlePreloading } from './idle-preloading';
import { KidTime } from './kid/kid-time';
import { FAMILY_SCREENS } from './screens';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withPreloading(IdlePreloading)),
    { provide: SCREEN_CONFIG, useValue: FAMILY_SCREENS },
    // Plan 6.4: kid-mode minutes are counted from the start; the header shows them
    { provide: KID_TIME, useFactory: () => inject(KidTime).today },
    provideAppInitializer(() => void inject(KidTime)),
    // Schema §8.1: public PKCE client; Keycloak and the API share the app's origin through Caddy
    provideFullstarCore({
      url: `${window.location.origin}/auth`,
      realm: 'fullstar',
      clientId: 'family-app',
      scope: 'openid email offline_access',
      persist: true,
      redirectPath: '/sign-in/code',
      signedOutPath: '/welcome',
      // App Flow §10: an ended session returns to C1; kid mode keeps working offline
      sessionEnded: { path: '/who', stayOn: ['/kid/', '/who'] },
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
