import { CanActivateFn, Routes } from '@angular/router';
import { familyGuard, signedInGuard, signedOutGuard } from '@fullstar/core';
import {
  CelebrationShell,
  FocusShell,
  PlaceholderPage,
  SkyListShell,
  ScreenDef,
  SkySheetShell,
  screenRoutes,
} from '@fullstar/ui';
import { ConsentPage } from './auth/consent.page';
import { SignInReturnPage } from './auth/sign-in-return.page';
import { WelcomePage } from './auth/welcome.page';
import { FAMILY_SCREENS } from './screens';
import { WhoPage } from './who/who.page';

/**
 * UX only; the API checks every call. A1 is for signed-out visitors; A2 and A3 handle both
 * states; setup (B1–B5) needs a sign-in; everything else needs a family.
 */
function guardsFor(screen: ScreenDef): CanActivateFn[] {
  switch (screen.id) {
    case 'A1':
      return [signedOutGuard('/who')];
    case 'A2':
    case 'A3':
      return [];
    default:
      return screen.id.startsWith('B') ? [signedInGuard] : [familyGuard('/sign-up')];
  }
}

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

/** App Flow §3: signed-in families land on Who is learning?; signed-out visitors on Welcome. */
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
    {
      pages: { A1: WelcomePage, A2: ConsentPage, A3: SignInReturnPage, C1: WhoPage },
      guards: guardsFor,
    },
  ),
  { path: '**', redirectTo: 'who' },
];
