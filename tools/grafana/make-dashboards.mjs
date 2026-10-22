// Plan 9.1: writes the provisioned Grafana dashboards (infra/grafana/dashboards/*.json).
// Run: node tools/grafana/make-dashboards.mjs   (CI checks the files are up to date)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../infra/grafana/dashboards');
const prometheus = { type: 'prometheus', uid: 'prometheus' };
const loki = { type: 'loki', uid: 'loki' };

function panel(
  title,
  targets,
  { unit = 'short', type = 'timeseries', w = 12, ds = prometheus } = {},
) {
  return {
    title,
    type,
    datasource: ds,
    gridPos: { w, h: 8 },
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: type === 'logs' ? { showTime: true, wrapLogMessage: true } : {},
    targets: targets.map(([expr, legendFormat], i) => ({
      refId: String.fromCharCode(65 + i),
      datasource: ds,
      expr,
      legendFormat,
    })),
  };
}

function dashboard(uid, title, panels) {
  let x = 0;
  let y = 0;
  for (const p of panels) {
    if (x + p.gridPos.w > 24) {
      x = 0;
      y += 8;
    }
    Object.assign(p.gridPos, { x, y });
    x += p.gridPos.w;
  }
  panels.forEach((p, i) => (p.id = i + 1));
  return {
    uid,
    title,
    tags: ['fullstar'],
    timezone: 'browser',
    schemaVersion: 41,
    version: 1,
    editable: false,
    refresh: '30s',
    time: { from: 'now-6h', to: 'now' },
    panels,
  };
}

const errors5xx = 'sum(rate(http_server_requests_seconds_count{job="api",status=~"5.."}[5m]))';
const requests = 'sum(rate(http_server_requests_seconds_count{job="api"}[5m]))';

const dashboards = {
  'api.json': dashboard('fullstar-api', 'FullStar · API', [
    panel(
      'API up',
      [
        ['up{job="api"}', 'api'],
        ['up{job="book-reader"}', 'book-reader'],
      ],
      { type: 'stat', w: 6 },
    ),
    panel('Error rate (5xx, 5 min)', [[`${errors5xx} / ${requests}`, 'errors']], {
      unit: 'percentunit',
      type: 'stat',
      w: 6,
    }),
    panel('Requests per second', [
      ['sum by (status) (rate(http_server_requests_seconds_count{job="api"}[5m]))', '{{status}}'],
    ]),
    panel(
      'p95 response time',
      [
        [
          'histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket{job="api"}[5m])))',
          'p95',
        ],
      ],
      { unit: 's' },
    ),
    panel(
      'JVM heap used',
      [['sum by (application) (jvm_memory_used_bytes{area="heap"})', '{{application}}']],
      { unit: 'bytes' },
    ),
    panel(
      'Disk used',
      [
        [
          '1 - node_filesystem_avail_bytes{job="node",fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{job="node",fstype!~"tmpfs|overlay|squashfs"}',
          '{{mountpoint}}',
        ],
      ],
      { unit: 'percentunit' },
    ),
    panel('Errors in container logs', [['{service=~".+"} |~ "(?i)error"', '']], {
      type: 'logs',
      w: 24,
      ds: loki,
    }),
  ]),
  'jobs.json': dashboard('fullstar-jobs', 'FullStar · Jobs', [
    panel('Waiting or in flight', [['fullstar_queue_messages{kind="main"}', '{{queue}}']]),
    panel('Results applied (15 min)', [
      [
        'sum by (type, outcome) (increase(fullstar_job_results_total[15m]))',
        '{{type}} {{outcome}}',
      ],
    ]),
    panel('Worker logs', [['{service=~"book-reader|reading-checker|voice-maker"}', '']], {
      type: 'logs',
      w: 24,
      ds: loki,
    }),
  ]),
  'dlqs.json': dashboard('fullstar-dlqs', 'FullStar · Dead-letter queues', [
    panel('Messages in DLQs', [['sum(fullstar_queue_messages{kind="dlq"})', 'all']], {
      type: 'stat',
      w: 6,
    }),
    panel('By queue', [['fullstar_queue_messages{kind="dlq"}', '{{queue}}']], { w: 18 }),
  ]),
  'prep.json': dashboard('fullstar-prep', 'FullStar · Prep turnaround', [
    panel('Open', [['fullstar_prep_tasks{status="open"}', 'open']], { type: 'stat', w: 6 }),
    panel('In progress', [['fullstar_prep_tasks{status="in_progress"}', 'in progress']], {
      type: 'stat',
      w: 6,
    }),
    panel('Oldest open task', [['fullstar_prep_oldest_age', 'oldest']], {
      unit: 's',
      type: 'stat',
      w: 6,
    }),
    panel('Average turnaround (done, 7 days)', [['fullstar_prep_turnaround', 'average']], {
      unit: 's',
      type: 'stat',
      w: 6,
    }),
    panel('Prep queue over time', [['fullstar_prep_tasks', '{{status}}']], { w: 24 }),
  ]),
};

mkdirSync(out, { recursive: true });
for (const [name, body] of Object.entries(dashboards)) {
  writeFileSync(join(out, name), JSON.stringify(body, null, 2) + '\n');
}
console.log(`Wrote ${Object.keys(dashboards).length} dashboards to infra/grafana/dashboards`);
