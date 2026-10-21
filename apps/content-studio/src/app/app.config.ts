import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideFullstarCore } from '@fullstar/core';
import { SCREEN_CONFIG, STUDIO_ACCOUNT } from '@fullstar/ui';
import { routes } from './app.routes';
import { StudioAccount } from './auth/studio-account';
import { STUDIO_SCREENS } from './screens';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: SCREEN_CONFIG, useValue: STUDIO_SCREENS },
    { provide: STUDIO_ACCOUNT, useValue: StudioAccount },
    // Schema §8.3: staff sessions are not kept after the tab closes (no offline sessions)
    provideFullstarCore({
      url: `${window.location.origin}/auth`,
      realm: 'fullstar',
      clientId: 'content-studio',
      scope: 'openid email',
      persist: false,
      redirectPath: '/sign-in',
      signedOutPath: '/sign-in',
    }),
  ],
};
