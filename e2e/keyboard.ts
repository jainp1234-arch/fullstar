import { Page, TestInfo, expect } from '@playwright/test';

/** Plan 9.4: keyboard-only walkthrough helpers; the steps are printed and attached to the report. */
export const steps: string[] = [];

export async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) {
      return '';
    }
    const labelled = el.getAttribute('aria-labelledby');
    const byId = labelled ? document.getElementById(labelled)?.textContent : null;
    // The text a screen reader reads: without aria-hidden parts such as icon glyphs
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
    return (el.getAttribute('aria-label') ?? byId ?? copy.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  });
}

/**
 * A control reached with Tab shows a ring. Headings the app focuses for screen readers after a
 * navigation (tabindex="-1", not in the Tab order) need none.
 */
async function focusRingVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) {
      return false;
    }
    if (el.getAttribute('tabindex') === '-1') {
      return true;
    }
    const style = getComputedStyle(el);
    return (
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
      style.boxShadow !== 'none'
    );
  });
}

/** Presses Tab until the focused control's name matches, checking each focus ring on the way. */
export async function tabTo(page: Page, name: RegExp, max = 40): Promise<void> {
  const passed: string[] = [];
  for (let presses = 1; presses <= max; presses++) {
    await page.keyboard.press('Tab');
    const focused = await focusedName(page);
    passed.push(focused);
    if (focused) {
      expect(await focusRingVisible(page), `focus ring on "${focused}"`).toBe(true);
    }
    if (name.test(focused)) {
      steps.push(`Tab ×${presses} → "${focused}" (focus ring visible)`);
      return;
    }
  }
  throw new Error(`No control matching ${name} within ${max} Tab presses: ${passed.join(' | ')}`);
}

export async function press(page: Page, key: string, then: string): Promise<void> {
  await page.keyboard.press(key);
  steps.push(`${key} → ${then}`);
}

/** Attaches and prints the recorded steps, then clears them. */
export async function recordSteps(testInfo: TestInfo): Promise<void> {
  const text = steps.join('\n');
  await testInfo.attach('keyboard walkthrough', { body: text, contentType: 'text/plain' });
  console.log(`Keyboard walkthrough: ${testInfo.title}\n${text}`);
  steps.length = 0;
}
