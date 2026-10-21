import { Routes } from '@angular/router';
import { staffGuard } from '@fullstar/core';
import { PlaceholderPage, StudioShell, screenRoutes } from '@fullstar/ui';
import { StaffSignInPage } from './auth/staff-sign-in.page';
import { STUDIO_SCREENS } from './screens';

/** Staff land on the dashboard; every screen but S1 needs an active staff account (UX only). */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  ...screenRoutes(STUDIO_SCREENS, { studio: StudioShell }, PlaceholderPage, {
    pages: { S1: StaffSignInPage },
    guards: (screen) => (screen.id === 'S1' ? [] : [staffGuard]),
  }),
  { path: '**', redirectTo: 'dashboard' },
];
