import { EN, ScreenConfig, ScreenDef } from '@fullstar/ui';

/** Every Content Studio screen (App Flow §7), all in shell E (Guidelines §10). S13 is super admin only. */
const SCREENS: readonly ScreenDef[] = [
  { id: 'S1', path: 'sign-in', shell: 'studio', mode: 'studio', nav: false, links: ['S2'] },
  {
    id: 'S2',
    path: 'dashboard',
    shell: 'studio',
    mode: 'studio',
    tab: 'dashboard',
    links: ['S12'],
  },
  { id: 'S8', path: 'uploads', shell: 'studio', mode: 'studio', tab: 'uploads' },
  {
    id: 'S9',
    path: 'uploads/:uploadId/prepare',
    sample: 'uploads/sample/prepare',
    shell: 'studio',
    mode: 'studio',
    parent: 'S8',
    links: ['S11'],
  },
  { id: 'S3', path: 'library', shell: 'studio', mode: 'studio', tab: 'library' },
  { id: 'S4', path: 'library/draft', shell: 'studio', mode: 'studio', parent: 'S3' },
  {
    id: 'S5',
    path: 'library/:contentId/edit',
    sample: 'library/sample/edit',
    shell: 'studio',
    mode: 'studio',
    parent: 'S3',
    links: ['S11'],
  },
  {
    id: 'S6',
    path: 'library/:contentId/publish',
    sample: 'library/sample/publish',
    shell: 'studio',
    mode: 'studio',
    parent: 'S5',
  },
  { id: 'S10', path: 'question-bank', shell: 'studio', mode: 'studio', tab: 'questionBank' },
  {
    id: 'S11',
    path: 'content-check',
    shell: 'studio',
    mode: 'studio',
    tab: 'contentCheck',
    links: ['S6'],
  },
  { id: 'S7', path: 'reports', shell: 'studio', mode: 'studio', tab: 'reports' },
  { id: 'S12', path: 'support', shell: 'studio', mode: 'studio', parent: 'S2' },
  { id: 'S13', path: 'staff', shell: 'studio', mode: 'studio', tab: 'staff' },
];

export const STUDIO_SCREENS: ScreenConfig = {
  appName: EN.app.studioName,
  screens: SCREENS,
  nav: {
    studio: [
      { tab: 'dashboard', label: EN.nav.studio.dashboard, icon: 'dashboard', screen: 'S2' },
      { tab: 'uploads', label: EN.nav.studio.uploads, icon: 'inbox', screen: 'S8' },
      { tab: 'library', label: EN.nav.studio.library, icon: 'library_books', screen: 'S3' },
      { tab: 'questionBank', label: EN.nav.studio.questionBank, icon: 'quiz', screen: 'S10' },
      { tab: 'contentCheck', label: EN.nav.studio.contentCheck, icon: 'fact_check', screen: 'S11' },
      { tab: 'reports', label: EN.nav.studio.reports, icon: 'report', screen: 'S7' },
      // Super admins only (Schema §9); the API refuses everyone else
      {
        tab: 'staff',
        label: EN.nav.studio.staff,
        icon: 'school',
        screen: 'S13',
        requires: 'super_admin',
      },
    ],
  },
};
