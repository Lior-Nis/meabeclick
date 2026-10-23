import { existsSync } from 'node:fs';

/**
 * Runtime controls that can enable an external integration, select an agent,
 * redirect an executable/model, or authorize a timer endpoint. Keep this
 * inventory shared by the entrypoint and executable regression tests.
 */
export const FORBIDDEN_EXTERNAL_CONFIG = Object.freeze([
  // Mail.
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'BOOKING_EMAIL_TO',

  // Calendar service account and legacy calendar/feed configuration.
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
  'GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
  'CALENDAR_ID',
  'CALENDAR_ICS_URLS',

  // Drive backup/sync OAuth and tutor Meet OAuth.
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REFRESH_TOKEN',
  'DRIVE_BACKUP_FOLDER_ID',
  'DRIVE_BACKUP_FOLDER',
  'GOOGLE_WEB_CLIENT_ID',
  'GOOGLE_WEB_CLIENT_SECRET',

  // WhatsApp/CallMeBot and operational Slack alerts.
  'CALLMEBOT_PHONE',
  'CALLMEBOT_API_KEY',
  'OPS_CALLMEBOT_PHONE',
  'OPS_CALLMEBOT_API_KEY',
  'OPS_SLACK_WEBHOOK_URL',

  // Timer authorization.
  'CRON_KEY',
  'GENERATION_HEALTH_STALE_DAYS',

  // Lesson/question engines, executable redirects, models and budgets.
  'LESSON_ENGINE',
  'CODEX_BIN',
  'CLAUDE_BIN',
  'OPENCODE_BIN',
  'LESSON_MODEL',
  'LESSON_EFFORT',
  'LESSON_TIMEOUT_MINUTES',
  'ASK_MODEL',
  'ASK_EFFORT',

  // Current and supported/legacy agent-provider credentials.
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENROUTER_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
]);

/** @param {NodeJS.ProcessEnv} env */
export function injectedExternalConfig(env = process.env) {
  return FORBIDDEN_EXTERNAL_CONFIG.filter((key) => Object.hasOwn(env, key));
}

/**
 * CODEX_HOME is required by the production image, so synthetic Compose pins
 * it to a credential-free path instead of omitting it. Any redirect or auth
 * file is rejected independently from the general inventory above.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {(path: string) => boolean} pathExists
 */
export function integrationGuardIssues(env = process.env, pathExists = existsSync) {
  const issues = injectedExternalConfig(env);
  if (env.CODEX_HOME !== '/tmp/no-codex-credentials') issues.push('CODEX_HOME');
  if (env.CODEX_HOME && pathExists(`${env.CODEX_HOME}/auth.json`)) issues.push('CODEX_HOME/auth.json');
  return issues;
}
