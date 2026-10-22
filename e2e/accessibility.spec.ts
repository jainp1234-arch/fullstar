import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { FakeServer, signInFamily } from './fakes';
import { walkFamilyApp } from './family-walk';
import { Visit } from './routes';

/**
 * Plan 9.4: every family-app screen at phone width has no WCAG 2.1 AA violation (axe), and every
 * Devanagari text sits inside lang="hi" so screen readers switch voice; then every screen at 200%
 * zoom (1280×800 seen as 640×400) reflows without sideways scrolling. The fake content is in
 * Hindi here (lesson, read-along, reading passage), so the Hindi screens are really checked.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Devanagari text outside lang="hi" on this screen, and whether the screen shows any. */
async function hindiWithoutLang(page: Page): Promise<{ missing: string[]; any: boolean }> {
  return page.evaluate(() => {
    const found: string[] = [];
    let any = false;
    const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (texts.nextNode()) {
      const text = texts.currentNode as Text;
      const element = text.parentElement;
      if (!element || !/[ऀ-ॿ]/.test(text.data) || element.closest('[aria-hidden="true"]')) {
        continue;
      }
      any = true;
      if (element.closest('[lang]')?.getAttribute('lang') !== 'hi') {
        found.push(text.data.trim().slice(0, 40));
      }
    }
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )) {
      if (/[ऀ-ॿ]/.test(field.value) && field.closest('[lang]')?.getAttribute('lang') !== 'hi') {
        found.push(`field: ${field.value.slice(0, 40)}`);
      }
    }
    return { missing: found, any };
  });
}

function inHindi(server: FakeServer): void {
  server.family.hindi = true;
  if (server.reading.passage) {
    Object.assign(server.reading.passage, {
      title: 'मीरा की खिड़की',
      lang: 'hi',
      text: 'मीरा खिड़की खोलती है और बाहर देखती है। पेड़ हवा में नाचते हैं।',
      word_count: 13,
    });
  }
}

test.describe('accessibility of every screen', () => {
  test('phone width: no WCAG 2.1 AA violations and Hindi marked lang="hi"', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const problems: string[] = [];
    const withHindi = new Set<string>();
    await walkFamilyApp(
      page,
      async (p: Page, visit: Visit) => {
        await p.evaluate(() => document.fonts.ready);
        const results = await new AxeBuilder({ page: p }).withTags(AXE_TAGS).analyze();
        for (const v of results.violations) {
          problems.push(`${visit.id} ${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
        }
        const hindi = await hindiWithoutLang(p);
        if (hindi.any) {
          withHindi.add(visit.id);
        }
        for (const text of hindi.missing) {
          problems.push(`${visit.id} Hindi without lang="hi": ${text}`);
        }
      },
      inHindi,
    );
    expect(problems).toEqual([]);
    // The check really saw Hindi: the lesson and the reading passage at least
    console.log(`Screens with Hindi: ${[...withHindi].sort().join(', ')}`);
    expect([...withHindi]).toEqual(expect.arrayContaining(['K4', 'K13']));
  });

  test('200% zoom: every screen reflows without sideways scrolling', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 640, height: 400 });
    const problems: string[] = [];
    await walkFamilyApp(
      page,
      async (p: Page, visit: Visit) => {
        const overflow = await p.evaluate(() => {
          const root = document.scrollingElement ?? document.documentElement;
          return root.scrollWidth - root.clientWidth;
        });
        if (overflow > 1) {
          problems.push(`${visit.id} scrolls sideways by ${overflow}px`);
        }
      },
      inHindi,
    );
    expect(problems).toEqual([]);
  });

  test('a Hindi read-along chapter: words and title in lang="hi", no violations', async ({
    page,
  }) => {
    const server = await signInFamily(page);
    inHindi(server);
    server.family.books.push({
      id: 'book-hindi',
      subject_id: 2,
      upload_mode: 'chapterwise',
      status: 'readalong_ready',
      class_level: 3,
      child_ids: ['child-asha'],
      chapters: [
        {
          id: 'ch-barish',
          number: 1,
          title: 'बारिश',
          status: 'readalong_ready',
          page_count: 2,
          unclear_pages: 0,
        },
      ],
      uploads: [],
    });
    await page.getByRole('button', { name: 'Asha' }).click();
    await page.getByRole('button', { name: /Hindi/ }).click();
    await page.getByRole('button', { name: /Chapter 1/ }).click();
    await page.getByRole('button', { name: /Read along/ }).click();
    await expect(page).toHaveURL(/\/kid\/read-along\/ch-barish/);
    await expect(page.getByText('बारिश').first()).toBeVisible();
    const hindi = await hindiWithoutLang(page);
    expect(hindi.any).toBe(true);
    expect(hindi.missing).toEqual([]);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
