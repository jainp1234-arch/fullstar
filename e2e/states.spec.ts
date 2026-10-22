import { Page, expect, test } from '@playwright/test';
import { FakeServer, enterPin, signInFamily, unlockParent } from './fakes';
import { fakeMicrophone } from './microphone';
import { goOffline, goOnline } from './offline';
import { navigateInApp } from './routes';

/**
 * Plan 7.5: one test per row of App Flow §9 (empty and loading) and §10 (errors), with the words of
 * Guidelines §16. The email-code rows run in Keycloak and are checked by OtpChallengeTest and
 * ThemeMessagesTest (infra/keycloak/email-otp); the reading-test rows wait for K12–K14 (Plan 8.3).
 */

async function asAsha(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Asha' }).click();
  await expect(page.getByRole('heading', { name: 'Hi Asha!' })).toBeVisible();
}

function readyEvs(server: FakeServer, chapterStatus = 'readalong_ready'): void {
  server.family.books.push({
    id: 'book-evs',
    subject_id: 4,
    upload_mode: 'chapterwise',
    status: chapterStatus,
    class_level: 3,
    child_ids: ['child-asha'],
    chapters: [
      {
        id: 'ch-water',
        number: 2,
        title: 'Water',
        status: chapterStatus,
        page_count: 2,
        unclear_pages: 0,
      },
    ],
    uploads: [],
  });
}

test.describe('App Flow §9 empty and loading states', () => {
  test('K1/K2 no book: grade-level content labelled Class 3 practice, never an empty shelf', async ({
    page,
  }) => {
    await signInFamily(page);
    await asAsha(page);
    await expect(page.getByText(/^Class 3 practice$/)).toHaveCount(4);
    await page.getByRole('button', { name: /English/ }).click();
    await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Birds and nests/ })).toBeVisible();
  });

  test('K1 book still being processed: not shown; the child keeps grade-level content', async ({
    page,
  }) => {
    const server = await signInFamily(page);
    readyEvs(server, 'processing');
    await asAsha(page);
    await expect(page.getByRole('button', { name: /EVS/ })).toContainText('Class 3 practice');
  });

  test('K3 lesson not ready: Watch lesson says Coming soon; Read along works meanwhile', async ({
    page,
  }) => {
    const server = await signInFamily(page);
    readyEvs(server);
    await asAsha(page);
    await page.getByRole('button', { name: /EVS/ }).click();
    await page.getByRole('button', { name: /Chapter 2: Water/ }).click();
    const lesson = page.getByRole('button', { name: /Watch lesson/ });
    await expect(lesson).toContainText('Coming soon');
    await lesson.click();
    await expect(page.getByText('Coming soon! Read along for now.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Read along/ })).toBeEnabled();
  });

  test('K11 no mistakes yet: "No mistakes to fix. Great job!" with a picture', async ({ page }) => {
    await signInFamily(page);
    await asAsha(page);
    await navigateInApp(page, '/kid/practice/mistakes');
    await expect(page.getByText('No mistakes to fix. Great job!')).toBeVisible();
    await expect(page.locator('app-empty-state img')).toBeVisible();
  });

  test('K12 no reading test yet: "Let\'s read your first story!" with a big start button', async ({
    page,
  }) => {
    await signInFamily(page);
    await asAsha(page);
    await navigateInApp(page, '/kid/read');
    await expect(page.getByRole('heading', { name: "Let's read your first story!" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start reading' })).toBeVisible();
  });

  test('P1 no activity yet: the getting-started checklist', async ({ page }) => {
    await signInFamily(page);
    await unlockParent(page, '/parent/progress');
    await page.getByRole('tab', { name: 'Ravi' }).click();
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
    for (const step of [
      'Add the school books',
      'Watch the first lesson together',
      'Take the first reading test',
    ]) {
      await expect(page.getByText(step)).toBeVisible();
    }
  });

  test('P3 no reading history: "Reading results will appear after the first test."', async ({
    page,
  }) => {
    await signInFamily(page);
    await unlockParent(page, '/parent/progress/reading');
    await expect(page.getByText('Reading results will appear after the first test.')).toBeVisible();
  });

  test('P4 no books: every subject offers Upload book and Add chapter and says practice is ready', async ({
    page,
  }) => {
    await signInFamily(page);
    await unlockParent(page, '/parent/books');
    const rows = page.locator('app-books-page .row');
    await expect(rows).toHaveCount(4);
    for (const row of await rows.all()) {
      await expect(
        row.getByText(
          'No book yet. Upload it so we can prepare lessons. Practice is ready meanwhile.',
        ),
      ).toBeVisible();
      await expect(row.getByRole('button', { name: 'Upload book' })).toBeVisible();
      await expect(row.getByRole('button', { name: 'Add first chapter' })).toBeVisible();
    }
  });

  test('P10 no worksheets: a Create your first worksheet button', async ({ page }) => {
    await signInFamily(page);
    await unlockParent(page, '/parent/worksheets');
    await expect(page.getByRole('button', { name: 'Create your first worksheet' })).toBeVisible();
  });

  test('P19 no messages: "You\'re all caught up."', async ({ page }) => {
    await signInFamily(page);
    await unlockParent(page, '/parent/messages');
    await expect(page.getByText("You're all caught up.")).toBeVisible();
  });

  test('loading: the owl in kid mode, grey placeholder blocks in parent mode, never blank', async ({
    page,
  }) => {
    await signInFamily(page);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/v1\/family\/(kid\/home|parent\/books)/, async (route) => {
      await held;
      await route.fallback();
    });
    await page.getByRole('button', { name: 'Asha' }).click();
    await expect(page.locator('app-owl-loader img')).toBeVisible();
    await expect(page.locator('app-skeleton')).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { name: 'Hi Asha!' })).toBeVisible();

    let releaseBooks: () => void = () => undefined;
    const heldBooks = new Promise<void>((resolve) => (releaseBooks = resolve));
    await page.unroute(/\/api\/v1\/family\/(kid\/home|parent\/books)/);
    await page.route(/\/api\/v1\/family\/parent\/books/, async (route) => {
      await heldBooks;
      await route.fallback();
    });
    await page.getByRole('button', { name: 'Parent mode' }).click();
    await enterPin(page);
    await navigateInApp(page, '/parent/books');
    await expect(page.locator('app-skeleton').first()).toBeVisible();
    await expect(page.locator('app-owl-loader')).toHaveCount(0);
    releaseBooks();
    await expect(page.locator('app-books-page .row').first()).toBeVisible();
  });
});

test.describe('App Flow §10 error states', () => {
  // Wrong or expired code, code email not arriving: Keycloak pages; OtpChallengeTest and
  // ThemeMessagesTest check the tries, the 30-second resend and the words.

  test('wrong parent PIN: the pad shakes; after 5, wait a minute or use Forgot PIN', async ({
    page,
  }) => {
    await signInFamily(page);
    await page.getByRole('button', { name: 'Parent mode' }).click();
    for (let i = 0; i < 5; i++) {
      await enterPin(page, '9999');
    }
    await expect(
      page.getByText('Too many wrong PINs. Try again in 1 minute or use Forgot PIN.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot PIN?' })).toBeVisible();
  });

  test('no internet: kid mode shows the cloud on what is not on the device; parent mode a banner', async ({
    page,
    context,
  }) => {
    await signInFamily(page);
    await asAsha(page);
    await page.getByRole('button', { name: /English/ }).click();
    await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await goOffline(page, context);
    // English was opened, so it stays; the other subjects show the cloud and say why
    await navigateInApp(page, '/kid/learn');
    await expect(page.getByRole('heading', { name: 'Hi Asha!' })).toBeVisible();
    const maths = page.getByRole('button', { name: /Maths/ });
    await expect(maths).toHaveAttribute('aria-disabled', 'true');
    await expect(maths.getByRole('img', { name: 'Needs the internet' })).toBeVisible();
    await expect(page.getByRole('button', { name: /English/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // aria-disabled: a child can still tap it, and hears why
    await maths.click({ force: true });
    await expect(page.getByText('This needs the internet.')).toBeVisible();

    await goOnline(page, context);
    await page.getByRole('button', { name: 'Parent mode' }).click();
    await enterPin(page);
    await expect(page).toHaveURL(/\/parent\/progress$/);
    await goOffline(page, context);
    await expect(page.getByText("You're offline. Some features are paused.")).toBeVisible();
    const banner = page.getByRole('status').filter({ hasText: "You're offline" });
    expect((await banner.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  });

  test('internet lost during an activity: the child keeps going; progress syncs later', async ({
    page,
    context,
  }) => {
    const server = await signInFamily(page);
    await asAsha(page);
    await page.getByRole('button', { name: /English/ }).click();
    await page.getByRole('button', { name: /Birds and nests/ }).click();
    await page.getByRole('button', { name: /Watch lesson/ }).click();
    await expect(page.getByText('A bird builds a nest.')).toBeVisible();
    await goOffline(page, context);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: /A nest/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('heading', { name: 'Well done! You got 3 stars.' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const before = server.family.syncs.length;
    await goOnline(page, context);
    await expect
      .poll(() => server.family.syncs.length, { timeout: 10_000 })
      .toBeGreaterThan(before);
  });

  test('microphone not allowed: "Ask Mummy/Papa to turn on the microphone." and steps for a parent', async ({
    page,
  }) => {
    await fakeMicrophone(page, true);
    await signInFamily(page);
    await asAsha(page);
    await navigateInApp(page, '/kid/read/test');
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByText('Ask Mummy/Papa to turn on the microphone.')).toBeVisible();
    await expect(page.getByText(/^For a parent: /)).toBeVisible();
  });

  test('recording not understood: "Let\'s try again." and no score', async ({ page }) => {
    await fakeMicrophone(page);
    const server = await signInFamily(page);
    server.reading.outcome = 'not_understood';
    await asAsha(page);
    await navigateInApp(page, '/kid/read/test');
    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.getByRole('button', { name: "I'm done" }).click();
    await expect(page.getByRole('heading', { name: "Let's try again." })).toBeVisible();
    await expect(page.getByText(/You got \d stars?/)).toHaveCount(0);
    expect(server.reading.tests[0]).toMatchObject({ status: 'not_understood', stars: 0 });
  });

  test('camera not allowed: steps to allow it, and Choose file for the gallery', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (descriptor: PermissionDescriptor) =>
        descriptor.name === ('camera' as PermissionName)
          ? Promise.resolve({ state: 'denied', onchange: null } as PermissionStatus)
          : query(descriptor);
    });
    await signInFamily(page);
    await unlockParent(page, '/parent/books/evs/add-chapter');
    await expect(page.getByText(/^The camera is not allowed for FullStar\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible();
  });

  test('wrong file type or too large: the limits in one sentence', async ({ page }) => {
    await signInFamily(page);
    await unlockParent(page, '/parent/books/maths/upload');
    await page
      .locator('app-upload-zone input[type="file"]')
      .last()
      .setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('notes'),
      });
    await expect(
      page.getByText(
        'Please use a PDF (up to 50 MB, 300 pages) or JPG/PNG photos (up to 10 MB each, 50 per upload).',
      ),
    ).toBeVisible();
  });

  test('unclear pages: Needs attention, and P8 retakes only those pages', async ({ page }) => {
    const server = await signInFamily(page);
    server.family.books.push({
      id: 'book-evs',
      subject_id: 4,
      upload_mode: 'chapterwise',
      status: 'needs_attention',
      class_level: 3,
      child_ids: ['child-asha'],
      chapters: [
        {
          id: 'ch-1',
          number: 1,
          title: 'Plants',
          status: 'needs_attention',
          page_count: 2,
          unclear_pages: 1,
          pages: [
            { id: 'p1', page_no: 1, quality: 'ok', confidence: 0.9 },
            { id: 'p2', page_no: 2, quality: 'unclear', confidence: 0.3 },
          ],
        },
      ],
      uploads: [],
    } as unknown as FakeServer['family']['books'][number]);
    await unlockParent(page, '/parent/books');
    const evs = page.locator('app-books-page .row').filter({ hasText: 'EVS' });
    await expect(evs.getByText('Needs attention').first()).toBeVisible();
    await evs.getByRole('button', { name: 'Fix 1 unclear page' }).click();
    await expect(page).toHaveURL(/\/parent\/books\/evs\/fix-pages\?child=child-asha&chapter=ch-1$/);
  });

  test("our team can't use an upload: a message links to Fix pages or Replace book", async ({
    page,
  }) => {
    const server = await signInFamily(page);
    readyEvs(server);
    server.family.messages.push({
      id: 'm-upload',
      kind: 'upload_problem',
      title: 'Your EVS upload needs a fix',
      body: 'Some pages are missing. Retake them or replace the book.',
      link: { screen: 'P4', subject: 'evs' },
      read_at: null,
      created_at: new Date().toISOString(),
    });
    await unlockParent(page, '/parent/messages');
    await page.getByRole('button', { name: 'Open: Your EVS upload needs a fix' }).click();
    await expect(page).toHaveURL(/\/parent\/books/);
    await expect(page.getByRole('button', { name: 'Replace book: EVS' })).toBeVisible();
  });

  test('file failed the virus check: "This file couldn\'t be used. Please try a different copy."', async ({
    page,
  }) => {
    const server = await signInFamily(page);
    server.family.books.push({
      id: 'book-maths',
      subject_id: 3,
      upload_mode: 'whole',
      status: 'needs_attention',
      class_level: 3,
      child_ids: ['child-asha'],
      chapters: [],
      uploads: [
        {
          id: 'up-1',
          family_book_id: 'book-maths',
          family_chapter_id: null,
          source: 'pdf',
          status: 'rejected',
          reject_reason: 'infected',
          file_count: 1,
          names: ['maths.pdf'],
        },
      ],
    });
    await unlockParent(page, '/parent/books');
    await expect(
      page.getByText("This file couldn't be used. Please try a different copy."),
    ).toBeVisible();
  });

  test('lesson fails to load: "Let\'s try again" with the owl and a retry button', async ({
    page,
  }) => {
    await signInFamily(page);
    await asAsha(page);
    let fail = true;
    await page.route(/\/api\/v1\/family\/kid\/lessons\//, (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              status: 'error',
              data: null,
              error: { code: 'INTERNAL_ERROR', message: 'x' },
            }),
          })
        : route.fallback(),
    );
    await page.getByRole('button', { name: /English/ }).click();
    await page.getByRole('button', { name: /Birds and nests/ }).click();
    await page.getByRole('button', { name: /Watch lesson/ }).click();
    const retry = page.locator('app-kid-retry');
    await expect(retry.getByText("Let's try again.")).toBeVisible();
    await expect(retry.locator('img')).toHaveAttribute('src', /mascot-owl/);
    fail = false;
    await retry.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('A bird builds a nest.')).toBeVisible();
  });

  test('server problem: kid "Let\'s try again"; parent the §16 explanation with Try again', async ({
    page,
  }) => {
    await signInFamily(page);
    const broken = /\/api\/v1\/family\/(kid\/home|parent\/worksheets)$/;
    let fail = true;
    await page.route(broken, (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              status: 'error',
              data: null,
              error: { code: 'INTERNAL_ERROR', message: 'x' },
            }),
          })
        : route.fallback(),
    );
    await page.getByRole('button', { name: 'Asha' }).click();
    await expect(page.locator('app-kid-retry').getByText("Let's try again.")).toBeVisible();

    await page.getByRole('button', { name: 'Parent mode' }).click();
    await enterPin(page);
    await expect(page).toHaveURL(/\/parent\/progress$/);
    await navigateInApp(page, '/parent/worksheets');
    const bar = page.locator('app-error-bar');
    await expect(
      bar.getByText('Something went wrong on our side. Please try again in a few minutes.'),
    ).toBeVisible();
    fail = false;
    await bar.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Create your first worksheet' })).toBeVisible();
  });

  test('signed out (session expired): back to C1, kid mode keeps working, parent mode signs in again', async ({
    page,
  }) => {
    await signInFamily(page);
    await asAsha(page);
    await page.getByRole('button', { name: /English/ }).click();
    await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Parent mode' }).click();
    await enterPin(page);
    await expect(page).toHaveURL(/\/parent\/progress$/);

    // The refresh token is refused and the API no longer accepts the access token
    await page.route(/\/openid-connect\/token$/, (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant' }),
      }),
    );
    await page.route(/\/api\/v1\/family\//, (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'error',
          data: null,
          error: { code: 'UNAUTHENTICATED', message: 'x' },
        }),
      }),
    );
    await navigateInApp(page, '/parent/books');
    await expect(page).toHaveURL(/\/who$/);
    await expect(page.locator('[data-screen]')).toHaveAttribute('data-screen', 'C1');

    // Kid mode: the device copy of what Asha opened
    await page.getByRole('button', { name: 'Asha' }).click();
    await expect(page.getByRole('heading', { name: 'Hi Asha!' })).toBeVisible();
    await page.getByRole('button', { name: /English/ }).click();
    await expect(page.getByRole('button', { name: /Birds and nests/ })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();

    // Parent mode asks for a new email code instead of the PIN
    await page.getByRole('button', { name: 'Parent mode' }).click();
    await expect(page.getByText('Your session ended. Please sign in again.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with an email code' })).toBeVisible();
    await expect(page.locator('app-pin-pad')).toHaveCount(0);

    // A reload still knows the family on this device
    await page.goto('/who');
    await expect(page.getByRole('button', { name: 'Asha' })).toBeVisible();
  });
});
