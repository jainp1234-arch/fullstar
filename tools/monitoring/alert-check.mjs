// Plan 9.1: checks the Grafana alerting set-up of the local stack and times an alert.
//
//   node tools/monitoring/alert-check.mjs [--force-dlq] [--firing "<rule title>"] [--within 300]
//
// --force-dlq puts a message straight into worksheet-render-dlq (a forced job failure), waits for
// "Job in a dead-letter queue" to fire, then empties that DLQ again. Needs GRAFANA_ADMIN_PASSWORD;
// GRAFANA_URL (default http://127.0.0.1:3001) and SQS_URL (default http://127.0.0.1:9324) are optional.
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    'force-dlq': { type: 'boolean', default: false },
    firing: { type: 'string' },
    within: { type: 'string', default: '300' },
    rules: { type: 'string', default: '4' },
    dashboards: { type: 'string', default: '4' },
  },
});

const grafana = process.env.GRAFANA_URL ?? 'http://127.0.0.1:3001';
const sqsUrl = process.env.SQS_URL ?? 'http://127.0.0.1:9324';
const password = process.env.GRAFANA_ADMIN_PASSWORD;
if (!password) {
  fail('GRAFANA_ADMIN_PASSWORD is not set');
}
const auth = 'Basic ' + Buffer.from(`admin:${password}`).toString('base64');
const DLQ = 'worksheet-render-dlq';

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

async function grafanaGet(path) {
  const response = await fetch(grafana + path, { headers: { Authorization: auth } });
  if (!response.ok) {
    fail(`GET ${path} answered ${response.status}`);
  }
  return response.json();
}

async function sqs(action, body) {
  const response = await fetch(sqsUrl + '/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': `AmazonSQS.${action}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    fail(`SQS ${action} answered ${response.status}`);
  }
  return response.json();
}

async function ruleStates() {
  const body = await grafanaGet('/api/prometheus/grafana/api/v1/rules');
  const states = new Map();
  for (const group of body.data?.groups ?? []) {
    for (const rule of group.rules ?? []) {
      states.set(rule.name, rule.state);
    }
  }
  return states;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rules = (await grafanaGet('/api/v1/provisioning/alert-rules')).filter((r) =>
  r.uid.startsWith('fullstar-'),
);
if (rules.length !== Number(args.rules)) {
  fail(`expected ${args.rules} FullStar alert rules, found ${rules.length}`);
}
console.log(`ok ${rules.length} alert rules: ${rules.map((r) => r.title).join(', ')}`);

const dashboards = await grafanaGet('/api/search?tag=fullstar&type=dash-db');
if (dashboards.length !== Number(args.dashboards)) {
  fail(`expected ${args.dashboards} FullStar dashboards, found ${dashboards.length}`);
}
console.log(`ok ${dashboards.length} dashboards: ${dashboards.map((d) => d.title).join(', ')}`);

const points = await grafanaGet('/api/v1/provisioning/contact-points');
if (!points.some((p) => p.name === 'fullstar-email' && p.type === 'email')) {
  fail('contact point fullstar-email is missing');
}
console.log('ok contact point fullstar-email');

let queueUrl;
let title = args.firing;
if (args['force-dlq']) {
  title = 'Job in a dead-letter queue';
  queueUrl = (await sqs('GetQueueUrl', { QueueName: DLQ })).QueueUrl;
  await sqs('SendMessage', {
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ forced_failure: new Date().toISOString() }),
  });
  console.log(`.. forced a job failure: one message in ${DLQ}`);
}

try {
  if (title) {
    const start = Date.now();
    const limit = Number(args.within) * 1000;
    let state;
    while (Date.now() - start < limit) {
      state = (await ruleStates()).get(title);
      if (state === 'firing') {
        console.log(`ok "${title}" fired after ${Math.round((Date.now() - start) / 1000)} s`);
        console.log('   With ALERT_EMAIL set, the email follows within about 30 s (group_wait).');
        break;
      }
      await sleep(5000);
    }
    if (state !== 'firing') {
      console.error(
        `FAIL "${title}" did not fire within ${args.within} s (state ${state ?? 'unknown'})`,
      );
      process.exitCode = 1;
    }
  }
} finally {
  if (queueUrl) {
    await sqs('PurgeQueue', { QueueUrl: queueUrl });
    console.log(`.. emptied ${DLQ}; the alert resolves at the next evaluations`);
  }
}
