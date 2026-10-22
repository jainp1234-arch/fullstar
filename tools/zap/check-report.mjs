// Plan 9.2: fails when a ZAP baseline JSON report has a medium or high alert.
//   node tools/zap/check-report.mjs zap-out/family.json zap-out/studio.json ...
import { readFileSync } from 'node:fs';

const RISK = { 0: 'informational', 1: 'low', 2: 'medium', 3: 'high' };
let blocking = 0;

for (const file of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  for (const site of report.site ?? []) {
    for (const alert of site.alerts ?? []) {
      const risk = Number(alert.riskcode);
      const urls = (alert.instances ?? []).slice(0, 3).map((i) => `${i.method} ${i.uri}`);
      console.log(`${RISK[risk] ?? risk}\t${alert.pluginid}\t${alert.name}\t${urls.join(' | ')}`);
      if (risk >= 2) {
        blocking++;
      }
    }
  }
}

if (blocking > 0) {
  console.error(`FAIL ${blocking} medium or high ZAP alert(s)`);
  process.exit(1);
}
console.log('ok no medium or high ZAP alerts');
