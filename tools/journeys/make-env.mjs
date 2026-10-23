// Plan 9.5: writes the throwaway .env for the journey stack (CI): every variable of .env.example,
// with fresh random secrets and the journey values below. Nothing here is a real credential.
//   node tools/journeys/make-env.mjs .env
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? '.env';
const secret = () => randomBytes(24).toString('hex');
const FIXED = {
  FULLSTAR_MODE: 'trial',
  S3_BUCKET: 'fullstar-journeys',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'journeys',
  SQS_REGION: 'ap-south-1',
  SQS_ACCESS_KEY_ID: 'local',
  SQS_SECRET_ACCESS_KEY: 'local',
  QUEUE_PREFIX: '',
  MAIL_FROM: 'journeys@fullstar.test',
  SMTP_HOST: 'mailpit',
  SMTP_PORT: '1025',
  SMTP_USERNAME: 'journeys',
  WHISPER_THREADS: '2',
  KEYCLOAK_ADMIN_USERNAME: 'admin',
  // Grafana and the voice model are not part of the journey stack
  ALERT_EMAIL: '',
  HF_TOKEN: '',
};
const KEEP_EMPTY =
  /^(ANTHROPIC_API_KEY|NEON_OWNER_URL|DB_|S3_ENDPOINT|S3_PUBLIC_ENDPOINT|SQS_ENDPOINT|S3_CREATE_BUCKET|API_PORT|CONSENT_VERSION|PRIVACY_NOTICE_URL|KEYCLOAK_ISSUER_URI|KEYCLOAK_ADMIN_URL|GOTENBERG_URL|VOICE_THREADS|CLAMAV_|MANAGEMENT_PORT|CORS_ALLOWED_ORIGINS|CLAUDE_MODEL|FEATURE_)/;

const lines = [];
for (const line of readFileSync('.env.example', 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!match) {
    continue;
  }
  const [, name, example] = match;
  const value = name in FIXED ? FIXED[name] : KEEP_EMPTY.test(name) ? example : secret();
  lines.push(`${name}=${value}`);
}
lines.push(`JOURNEY_DB_PASSWORD=${secret()}`);
writeFileSync(out, lines.join('\n') + '\n');
console.log(`Wrote ${out} (${lines.length} variables, secrets generated)`);
