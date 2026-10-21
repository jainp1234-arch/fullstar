import { Routes } from '@angular/router';
import { staffGuard, superAdminGuard } from '@fullstar/core';
import { PlaceholderPage, StudioShell, screenRoutes } from '@fullstar/ui';
import { StaffSignInPage } from './auth/staff-sign-in.page';
import { DashboardPage } from './dashboard/dashboard.page';
import { STUDIO_SCREENS } from './screens';
import { StaffPage } from './staff/staff.page';

/** Staff land on the dashboard; every screen but S1 needs an active staff account (UX only). */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  ...screenRoutes(STUDIO_SCREENS, { studio: StudioShell }, PlaceholderPage, {
    pages: { S1: StaffSignInPage, S2: DashboardPage, S13: StaffPage },
    guards: (screen) => {
      if (screen.id === 'S1') {
        return [];
      }
      return screen.id === 'S13' ? [staffGuard, superAdminGuard('/dashboard')] : [staffGuard];
    },
  }),
  { path: '**', redirectTo: 'dashboard' },
];
