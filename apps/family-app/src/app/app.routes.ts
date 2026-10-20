import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

/** /dev/ui: the UI gallery, in dev builds only (Guidelines §18). */
const devRoutes: Routes = isDevMode()
  ? [
      {
        path: 'dev/ui',
        loadComponent: () => import('@fullstar/ui/gallery').then((m) => m.UiGallery),
      },
    ]
  : [];

export const routes: Routes = [...devRoutes];
