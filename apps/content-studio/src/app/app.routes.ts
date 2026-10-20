import { Routes } from '@angular/router';
import { PlaceholderPage, StudioShell, screenRoutes } from '@fullstar/ui';
import { STUDIO_SCREENS } from './screens';

/** Staff land on the dashboard (staff sign-in arrives in Plan 2.4). */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  ...screenRoutes(STUDIO_SCREENS, { studio: StudioShell }, PlaceholderPage),
  { path: '**', redirectTo: 'dashboard' },
];
