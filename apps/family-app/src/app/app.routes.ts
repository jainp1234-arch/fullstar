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
import { ConsentPage } from './auth/consent.page';
import { SignInReturnPage } from './auth/sign-in-return.page';
import { BookUploadPage } from './books/book-upload.page';
import { CheckChaptersPage } from './books/check-chapters.page';
import { FixPagesPage } from './books/fix-pages.page';
import { LessonPreviewPage } from './books/lesson-preview.page';
import { MessagesPage } from './messages/messages.page';
import { ActivityPage } from './kid/activity.page';
import { LearnHomePage } from './kid/learn-home.page';
import { SubjectPage } from './kid/subject.page';
import { LessonPlayerPage } from './kid/lesson-player.page';
import { WellDonePage } from './kid/well-done.page';
import { ReadAlongPage } from './kid/read-along.page';
import { PracticeHomePage } from './kid/practice-home.page';
import { PracticeSetPage } from './kid/practice-set.page';
import { TablesPage } from './kid/tables.page';
import { WorksheetOnscreenPage } from './kid/worksheet-onscreen.page';
import { CreateWorksheetPage } from './worksheets/create-worksheet.page';
import { PrintWorksheetPage } from './worksheets/print-worksheet.page';
import { WorksheetSolutionsPage } from './worksheets/worksheet-solutions.page';
import { WorksheetsPage } from './worksheets/worksheets.page';
import { ProgressPage } from './parent/progress.page';
import { SubjectProgressPage } from './parent/subject-progress.page';
import { BooksPage } from './books/books.page';
import { WelcomePage } from './auth/welcome.page';
import { ForgotPinPage } from './parent/forgot-pin.page';
import { ParentPinPage } from './parent/parent-pin.page';
import { FAMILY_SCREENS } from './screens';
import { EditChildPage } from './settings/edit-child.page';
import { HelpPage } from './settings/help.page';
import { PrivacyPage } from './settings/privacy.page';
import { SettingsPage } from './settings/settings.page';
import { SetupBooksPage } from './setup/setup-books.page';
import { SetupChildPage } from './setup/setup-child.page';
import { SetupDonePage } from './setup/setup-done.page';
import { SetupPinPage } from './setup/setup-pin.page';
import { SetupTimeLimitPage } from './setup/setup-time-limit.page';
import { WhoPage } from './who/who.page';

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
      pages: {
        A1: WelcomePage,
        A2: ConsentPage,
        A3: SignInReturnPage,
        A4: ForgotPinPage,
        B1: SetupPinPage,
        B2: SetupChildPage,
        B3: SetupBooksPage,
        B4: SetupTimeLimitPage,
        B5: SetupDonePage,
        C1: WhoPage,
        K1: LearnHomePage,
        K2: SubjectPage,
        K3: ActivityPage,
        K4: LessonPlayerPage,
        K5: ReadAlongPage,
        K6: WorksheetOnscreenPage,
        K7: WellDonePage,
        K8: PracticeHomePage,
        K9: PracticeSetPage,
        K10: TablesPage,
        K11: PracticeSetPage,
        P0: ParentPinPage,
        P1: ProgressPage,
        P2: SubjectProgressPage,
        P4: BooksPage,
        P5: BookUploadPage,
        P6: CheckChaptersPage,
        P7: BookUploadPage,
        P8: FixPagesPage,
        P8a: LessonPreviewPage,
        P10: WorksheetsPage,
        P11: CreateWorksheetPage,
        P12: PrintWorksheetPage,
        P13: WorksheetSolutionsPage,
        P14: SettingsPage,
        P15: EditChildPage,
        P16: HelpPage,
        P17: PrivacyPage,
        P19: MessagesPage,
      },
      guards: guardsFor,
    },
  ),
  { path: '**', redirectTo: 'who' },
];
