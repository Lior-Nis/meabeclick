#!/usr/bin/env node
/**
 * Pull a backup back OUT of Google Drive.
 *
 *   node server/drive/fetch-backup.mjs [YYYY-MM-DD] [target-dir]
 *
 * With no date it takes the newest day Drive holds. The target defaults to
 * a fresh temp directory, printed at the end, so this never writes near the
 * live data by accident.
 *
 * ## Why this exists
 *
 * server/README.md says the Drive copy is what makes this VPS disposable —
 * "rebuild the box, restore from Drive, carry on". Until this script that
 * was a claim nobody could act on: the uploader could put a backup on Drive
 * and nothing in the tree could take one back. A backup you have never
 * fetched is not a backup, it is a hope with an invoice.
 *
 * It downloads only; it does not restore. Feed its output to the existing
 * drill, which already knows how to check a restore and refuses to touch
 * production:
 *
 *   node server/drive/fetch-backup.mjs 2026-09-18 /tmp/from-drive
 *   BACKUP_DIR=/tmp/from-drive bash server/restore-db.sh 2026-09-18 /tmp/drive-drill
 *
 * Credentials are the same ones the nightly upload uses — the OAuth client
 * and refresh token in .env, owned by the business account. Note this is
 * GOOGLE_OAUTH_REFRESH_TOKEN, not the retired GOOGLE_REFRESH_TOKEN.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, accessToken, ensureFolder, listBackups, downloadFile } from './client.mjs';

const [, , wantedStamp, wantedTarget] = process.argv;

// readConfig returns { cfg, missing } — destructure it. Passing the wrapper
// straight to accessToken sends three undefined credentials and gets a 401
// that reads exactly like a revoked token, which cost a while to unpick.
const { cfg, missing } = readConfig();
if (missing.length) {
  console.error(`missing Drive credentials in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const token = await accessToken(cfg);
const folderId = cfg.folderId || (await ensureFolder(token, cfg.folderName));

const files = await listBackups(token, folderId);
if (!files.length) {
  console.error(`no backups in the Drive folder (${cfg.folderName})`);
  process.exit(1);
}

/** Every day Drive holds a database for, newest last. */
const stamps = [...new Set(
  files.map(f => /^results-(\d{4}-\d{2}-\d{2})\.db$/.exec(f.name)?.[1]).filter(Boolean),
)].sort();

if (!stamps.length) {
  console.error('the Drive folder holds files, but none named results-<date>.db');
  process.exit(1);
}

const stamp = wantedStamp || stamps[stamps.length - 1];
if (!stamps.includes(stamp)) {
  console.error(`no database backup for ${stamp} on Drive. Available: ${stamps.join(', ')}`);
  process.exit(1);
}

const target = wantedTarget || mkdtempSync(join(tmpdir(), 'mbc-drive-'));
mkdirSync(target, { recursive: true });

/* The archive is optional the same way backup-db.sh treats it as optional:
   a day before the file state was captured legitimately has no tar. Saying
   so beats failing, because the database half is still worth restoring. */
const wanted = [`results-${stamp}.db`, `files-${stamp}.tar.gz`];
let got = 0;
for (const name of wanted) {
  const file = files.find(f => f.name === name);
  if (!file) {
    console.warn(`  (no ${name} on Drive for ${stamp})`);
    continue;
  }
  const bytes = await downloadFile(token, file.id);
  writeFileSync(join(target, name), bytes, { mode: 0o600 });
  console.log(`  ${name} — ${bytes.length} bytes`);
  got++;
}

if (!got) {
  console.error(`nothing downloadable for ${stamp}`);
  process.exit(1);
}

console.log(`\nfetched ${stamp} from Drive into ${target}`);
console.log('To check it without touching production:');
console.log(`  BACKUP_DIR=${target} bash server/restore-db.sh ${stamp} /tmp/drive-drill`);
