import { Routes } from '@angular/router';

/** Set by the Angular CLI at build time: false in production, so the gallery is tree-shaken. */
declare const ngDevMode: unknown;

/** /dev/ui: the UI gallery, in dev builds only (Guidelines §18). */
const devRoutes: Routes =
  typeof ngDevMode === 'undefined' || ngDevMode
    ? [
        {
          path: 'dev/ui',
          loadComponent: () => import('@fullstar/ui/gallery').then((m) => m.UiGallery),
        },
      ]
    : [];

export const routes: Routes = [...devRoutes];
