// Plan 9.3: Lighthouse 13 on the phone profile (its default: mobile emulation, slow 4G, 4x CPU
// slowdown) against the production family-app build. Performance, Accessibility and Best Practices
// must each be at least 90 (decided 22 Oct 2026: Lighthouse has no PWA category since version 12;
// installability is e2e/installable.spec.ts). Run after `npm run build`: npm run lighthouse
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const PORT = 4310;
const PAGES = ['/'];
const CATEGORIES = ['performance', 'accessibility', 'best-practices'];
const MIN = 0.9;
const OUT = 'lighthouse-report';

const server = spawn(
  process.execPath,
  ['scripts/serve-static.mjs', 'dist/family-app/browser', String(PORT)],
  {
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
await new Promise((resolve, reject) => {
  server.stdout.once('data', resolve);
  server.once('exit', (code) => reject(new Error(`static server exited (${code})`)));
});

const chrome = await chromeLauncher.launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ['--headless=new', '--no-sandbox'],
});
let failed = false;
try {
  mkdirSync(OUT, { recursive: true });
  for (const path of PAGES) {
    // Median of five runs, so one slow CI moment does not decide the score
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const result = await lighthouse(`http://127.0.0.1:${PORT}${path}`, {
        port: chrome.port,
        output: 'html',
        onlyCategories: CATEGORIES,
        logLevel: 'error',
      });
      runs.push(result);
    }
    for (const category of CATEGORIES) {
      const scores = runs.map((r) => r.lhr.categories[category].score ?? 0).sort((a, b) => a - b);
      const median = scores[2];
      const ok = median >= MIN;
      failed ||= !ok;
      console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${path} ${category} ${Math.round(median * 100)} (runs ${scores.map((s) => Math.round(s * 100)).join(', ')})`,
      );
    }
    const name = path === '/' ? 'welcome' : path.replaceAll('/', '-');
    writeFileSync(`${OUT}/${name}.html`, runs[2].report);
    for (const audit of Object.values(runs[2].lhr.audits)) {
      if (audit.score !== null && audit.score < 0.9 && audit.scoreDisplayMode !== 'informative') {
        console.log(`     ${audit.id}: ${audit.displayValue ?? audit.title}`);
      }
    }
  }
} finally {
  chrome.kill();
  server.kill();
}
if (failed) {
  console.error(`FAIL a Lighthouse category is below ${MIN * 100}; reports in ${OUT}/`);
  process.exit(1);
}
