import { Routes } from '@angular/router';
import {
  CelebrationShell,
  FocusShell,
  PlaceholderPage,
  SkyListShell,
  SkySheetShell,
  screenRoutes,
} from '@fullstar/ui';
import { FAMILY_SCREENS } from './screens';

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

/** App Flow §3: signed-in families land on Who is learning? (sign-in arrives in Plan 2.4). */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'who' },
  ...devRoutes,
  ...screenRoutes(
    FAMILY_SCREENS,
    {
      'sky-list': SkyListShell,
      'sky-sheet': SkySheetShell,
      focus: FocusShell,
      celebration: CelebrationShell,
    },
    PlaceholderPage,
  ),
  { path: '**', redirectTo: 'who' },
];
