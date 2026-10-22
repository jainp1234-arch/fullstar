import { expect, test, type Page } from '@playwright/test';

/**
 * Plan 9.2: the production builds run under the strict Content-Security-Policy that Caddy sends
 * (infra/caddy/security-headers.caddy): a new nonce per response, the same one in index.html, and
 * no CSP violation while the app starts.
 *
 * Opt-in: needs the ZAP stack (infra/zap/docker-compose.yml) on http://localhost:8088.
 *   ZAP_STACK=1 npx playwright test --project=csp
 */
test.skip(!process.env['ZAP_STACK'], 'Set ZAP_STACK=1 with the ZAP stack running');

const PAGES = ['/', '/studio/'];

async function open(page: Page, path: string): Promise<{ nonce: string; violations: string[] }> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  const csp = (await response?.headerValue('content-security-policy')) ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? '';
  expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
  expect(csp).not.toContain('unsafe-inline');
  expect(await response?.headerValue('x-frame-options')).toBe('DENY');
  expect(await response?.headerValue('x-content-type-options')).toBe('nosniff');

  await expect(page.locator('app-root > *').first()).toBeAttached();
  await expect(page.locator('app-root')).toHaveAttribute('ngcspnonce', nonce);
  const violations = await page.evaluate(
    () => (window as unknown as { cspViolations: string[] }).cspViolations,
  );
  return { nonce, violations };
}

for (const path of PAGES) {
  test(`${path} starts under the strict CSP with a new nonce each time`, async ({ page }) => {
    const first = await open(page, path);
    expect(first.violations).toEqual([]);
    const again = await open(page, path);
    expect(again.violations).toEqual([]);
    expect(again.nonce).not.toBe(first.nonce);
  });
}
