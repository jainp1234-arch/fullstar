import { Page, expect } from '@playwright/test';
import { FakeServer, enterPin, signInFamily } from './fakes';
import { OnVisit, Visit, navigateInApp, onScreen, walk } from './routes';

/**
 * Signs in with the fakes and walks every family-app screen of App Flow §4–§6 (kid mode with a
 * picked child, parent mode after the PIN, setup), calling onVisit once per screen. Screens that
 * open from buttons rather than links are visited directly. Used by family-routes (shells and
 * navigation) and accessibility (Plan 9.4). setup can change the fake data after sign-in.
 */
export async function walkFamilyApp(
  page: Page,
  onVisit?: OnVisit,
  setup?: (server: FakeServer) => void,
): Promise<Map<string, Visit>> {
  const server = await signInFamily(page);
  setup?.(server);
  // Kid mode needs a picked child and parent mode the PIN, both in memory: no reloads
  const seen = await walk(page, [], new Map(), onVisit);
  await page.getByRole('button', { name: 'Asha' }).click();
  await onScreen(page, 'K1');
  await walk(page, [], seen, onVisit);
  // K3 opens read-along only for book chapters and worksheets arrive in Phase 7 (Plan 6.1)
  // K12 opens K13 with a button, and K14 needs a test id (Plan 8.3)
  for (const path of [
    '/kid/read-along/sample',
    '/kid/worksheet/sample',
    '/kid/well-done',
    '/kid/read/test',
    '/kid/read/result',
  ]) {
    await navigateInApp(page, path);
    await walk(page, [], seen, onVisit);
  }
  await navigateInApp(page, '/kid/learn');
  await page.getByRole('button', { name: 'Parent mode' }).click();
  await onScreen(page, 'P0');
  await walk(page, [], seen, onVisit);
  await enterPin(page);
  await expect(page).toHaveURL(/\/parent\/progress$/);
  await onScreen(page, 'P1');
  await walk(page, [], seen, onVisit);
  // P14 opens these with buttons, not links
  for (const path of [
    '/parent/settings/children/child-asha',
    '/parent/settings/help',
    '/parent/settings/privacy',
    // P4 opens the book screens with buttons (Plan 5.1)
    '/parent/books/english/upload',
    '/parent/books/english/add-chapter',
    '/parent/books/english/chapters',
    '/parent/books/english/fix-pages',
    '/parent/books/english/preview',
    '/parent/books/english/replace',
    // P18 opens from a P13 question button (Plan 7.3)
    '/parent/report',
    // P1 is real (Plan 6.4): reading history arrives with Phase 7; the bell opens P19
    '/parent/progress/reading',
    // With no worksheets yet, P10 offers Create as a button (Plan 7.2)
    '/parent/worksheets/new',
    '/parent/worksheets/sample/print',
    '/parent/worksheets/sample/solutions',
    '/parent/messages',
  ]) {
    await navigateInApp(page, path);
    await walk(page, [], seen, onVisit);
  }
  // Setup and sign-up screens need only a family; B4 also asks for the PIN
  await walk(page, ['/sign-up', '/parent/forgot-pin', '/setup/pin', '/setup/child'], seen, onVisit);
  await walk(page, ['/setup/books', '/setup/done'], seen, onVisit);
  await page.goto('/setup/time-limit');
  await expect(page).toHaveURL(/\/parent\/pin\?next=%2Fsetup%2Ftime-limit$/);
  await enterPin(page);
  await expect(page).toHaveURL(/\/setup\/time-limit$/);
  await onScreen(page, 'B4');
  await walk(page, [], seen, onVisit);
  return seen;
}
