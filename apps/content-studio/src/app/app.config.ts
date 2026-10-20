import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { SCREEN_CONFIG } from '@fullstar/ui';
import { routes } from './app.routes';
import { STUDIO_SCREENS } from './screens';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: SCREEN_CONFIG, useValue: STUDIO_SCREENS },
  ],
};
