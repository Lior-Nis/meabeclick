import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const DATA_DIR = '/synthetic-data';
const DB_PATH = '/synthetic-data/synthetic.db';
const MARKER = '/synthetic-data/.meabeclick-synthetic-volume';
const MARKER_BODY = 'meabeclick-synthetic-volume-v1\n';

const forbidden = [
  'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'BOOKING_EMAIL_TO',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN',
  'GOOGLE_WEB_CLIENT_ID', 'GOOGLE_WEB_CLIENT_SECRET',
  'CALLMEBOT_PHONE', 'CALLMEBOT_API_KEY', 'OPS_CALLMEBOT_PHONE', 'OPS_CALLMEBOT_API_KEY',
  'OPS_SLACK_WEBHOOK_URL', 'OPENAI_API_KEY', 'CALENDAR_ID', 'CALENDAR_ICS_URLS',
  'DRIVE_BACKUP_FOLDER_ID', 'DRIVE_BACKUP_FOLDER',
];

/** @param {string} message */
function refuse(message) {
  console.error(`[synthetic] refusing to start: ${message}`);
  process.exit(78);
}

if (process.env.SYNTHETIC_TEST_MODE !== '1') refuse('SYNTHETIC_TEST_MODE must be 1');
if (process.env.DATA_DIR !== DATA_DIR) refuse(`DATA_DIR must be ${DATA_DIR}`);
if (process.env.DB_PATH !== DB_PATH) refuse(`DB_PATH must be ${DB_PATH}`);
if (process.env.PORTAL_DIR !== `${DATA_DIR}/portal`) refuse('PORTAL_DIR must stay inside the synthetic volume');
if (process.env.ORIGIN !== process.env.SITE_URL || !process.env.ORIGIN?.startsWith('http://127.0.0.1:')) {
  refuse('ORIGIN and SITE_URL must be the same loopback-only URL');
}

const injected = forbidden.filter((key) => process.env[key]);
if (injected.length) refuse(`external integration variables are set: ${injected.join(', ')}`);

const codexAuth = `${process.env.CODEX_HOME ?? ''}/auth.json`;
if (existsSync(codexAuth)) refuse('lesson-engine credentials are present');

mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(MARKER)) {
  const unexpected = readdirSync(DATA_DIR).filter((name) => name !== 'portal');
  if (unexpected.length) refuse('unmarked data directory is not empty');
  writeFileSync(MARKER, MARKER_BODY, { encoding: 'utf8', flag: 'wx', mode: 0o444 });
} else if (readFileSync(MARKER, 'utf8') !== MARKER_BODY) {
  refuse('synthetic volume marker is invalid');
}
mkdirSync(`${DATA_DIR}/portal`, { recursive: true });

const child = spawn(process.execPath, ['build/index.js'], { stdio: 'inherit', env: process.env });
/** @type {NodeJS.Signals[]} */
const forwardedSignals = ['SIGINT', 'SIGTERM'];
for (const signal of forwardedSignals) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error(`[synthetic] app spawn failed: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
