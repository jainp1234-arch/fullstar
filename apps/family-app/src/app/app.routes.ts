import { CanActivateFn, Routes } from '@angular/router';
import { familyGuard, kidGuard, parentGuard, signedOutGuard } from '@fullstar/core';
import {
  CelebrationShell,
  FocusShell,
  PlaceholderPage,
  SkyListShell,
  ScreenDef,
  SkySheetShell,
  screenRoutes,
} from '@fullstar/ui';
import { FAMILY_SCREENS } from './screens';

const CONSENT = '/sign-up';
const PIN = '/parent/pin';
const SETUP = { pin: '/setup/pin', child: '/setup/child' };

/**
 * UX only; the API checks every call. A1 is for signed-out visitors; A2 and A3 handle both
 * states. Setup (B1–B5) and A4 need a family; B4 also the parent grant B1 returns (B2 may add
 * the first child without one). Everything else needs a finished setup; kid screens a picked
 * child, parent screens the PIN.
 */
function guardsFor(screen: ScreenDef): CanActivateFn[] {
  switch (screen.id) {
    case 'A1':
      return [signedOutGuard('/who')];
    case 'A2':
    case 'A3':
      return [];
    case 'A4':
    case 'B1':
    case 'B2':
    case 'B3':
    case 'B5':
      return [familyGuard(CONSENT)];
    case 'B4':
      return [familyGuard(CONSENT), parentGuard(PIN)];
    case 'C1':
    case 'P0':
      return [familyGuard(CONSENT, SETUP)];
    default:
      return screen.mode === 'kid'
        ? [familyGuard(CONSENT, SETUP), kidGuard('/who')]
        : [familyGuard(CONSENT, SETUP), parentGuard(PIN)];
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
      // Plan 9.3: each screen is its own chunk, so the first load carries only the first screen
      lazyPages: {
        A1: () => import('./auth/welcome.page').then((m) => m.WelcomePage),
        A2: () => import('./auth/consent.page').then((m) => m.ConsentPage),
        A3: () => import('./auth/sign-in-return.page').then((m) => m.SignInReturnPage),
        A4: () => import('./parent/forgot-pin.page').then((m) => m.ForgotPinPage),
        B1: () => import('./setup/setup-pin.page').then((m) => m.SetupPinPage),
        B2: () => import('./setup/setup-child.page').then((m) => m.SetupChildPage),
        B3: () => import('./setup/setup-books.page').then((m) => m.SetupBooksPage),
        B4: () => import('./setup/setup-time-limit.page').then((m) => m.SetupTimeLimitPage),
        B5: () => import('./setup/setup-done.page').then((m) => m.SetupDonePage),
        C1: () => import('./who/who.page').then((m) => m.WhoPage),
        K1: () => import('./kid/learn-home.page').then((m) => m.LearnHomePage),
        K2: () => import('./kid/subject.page').then((m) => m.SubjectPage),
        K3: () => import('./kid/activity.page').then((m) => m.ActivityPage),
        K4: () => import('./kid/lesson-player.page').then((m) => m.LessonPlayerPage),
        K5: () => import('./kid/read-along.page').then((m) => m.ReadAlongPage),
        K6: () => import('./kid/worksheet-onscreen.page').then((m) => m.WorksheetOnscreenPage),
        K7: () => import('./kid/well-done.page').then((m) => m.WellDonePage),
        K8: () => import('./kid/practice-home.page').then((m) => m.PracticeHomePage),
        K9: () => import('./kid/practice-set.page').then((m) => m.PracticeSetPage),
        K10: () => import('./kid/tables.page').then((m) => m.TablesPage),
        K11: () => import('./kid/practice-set.page').then((m) => m.PracticeSetPage),
        K12: () => import('./kid/reading-home.page').then((m) => m.ReadingHomePage),
        K13: () => import('./kid/reading-test.page').then((m) => m.ReadingTestPage),
        K14: () => import('./kid/reading-result.page').then((m) => m.ReadingResultPage),
        P0: () => import('./parent/parent-pin.page').then((m) => m.ParentPinPage),
        P1: () => import('./parent/progress.page').then((m) => m.ProgressPage),
        P2: () => import('./parent/subject-progress.page').then((m) => m.SubjectProgressPage),
        P3: () => import('./parent/reading-history.page').then((m) => m.ReadingHistoryPage),
        P4: () => import('./books/books.page').then((m) => m.BooksPage),
        P5: () => import('./books/book-upload.page').then((m) => m.BookUploadPage),
        P6: () => import('./books/check-chapters.page').then((m) => m.CheckChaptersPage),
        P7: () => import('./books/book-upload.page').then((m) => m.BookUploadPage),
        P8: () => import('./books/fix-pages.page').then((m) => m.FixPagesPage),
        P9: () => import('./books/replace-book.page').then((m) => m.ReplaceBookPage),
        P8a: () => import('./books/lesson-preview.page').then((m) => m.LessonPreviewPage),
        P10: () => import('./worksheets/worksheets.page').then((m) => m.WorksheetsPage),
        P11: () => import('./worksheets/create-worksheet.page').then((m) => m.CreateWorksheetPage),
        P12: () => import('./worksheets/print-worksheet.page').then((m) => m.PrintWorksheetPage),
        P13: () =>
          import('./worksheets/worksheet-solutions.page').then((m) => m.WorksheetSolutionsPage),
        P14: () => import('./settings/settings.page').then((m) => m.SettingsPage),
        P15: () => import('./settings/edit-child.page').then((m) => m.EditChildPage),
        P16: () => import('./settings/help.page').then((m) => m.HelpPage),
        P17: () => import('./settings/privacy.page').then((m) => m.PrivacyPage),
        P18: () => import('./settings/report.page').then((m) => m.ReportPage),
        P19: () => import('./messages/messages.page').then((m) => m.MessagesPage),
      },
      guards: guardsFor,
    },
  ),
  { path: '**', redirectTo: 'who' },
];
