#!/usr/bin/env node
/**
 * Copies today's backup artefacts to Drive, and prunes old ones there.
 *
 * Called at the end of server/backup-db.sh. It NEVER fails that script: a
 * Drive outage, a revoked token or a missing config must not cost the local
 * backup, which is the one that already works. It says what went wrong and
 * exits 0.
 *
 * This is what makes the VPS disposable. Until now every copy of the
 * database and every student's portal file lived on one machine, so losing
 * it lost the service — a restore drill proved the data restores, but only
 * from backups sitting on the same disk as the original.
 *
 *   node server/drive/upload-backup.mjs <dir> [YYYY-MM-DD]
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readConfig, accessToken, ensureFolder, uploadFile, listBackups, deleteFile, expiredBackups } from './client.mjs';

const dir = process.argv[2];
const stamp = process.argv[3] || new Date().toISOString().slice(0, 10);
const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 14);

if (!dir) {
  console.error('usage: node server/drive/upload-backup.mjs <backup-dir> [date]');
  process.exit(1);
}

const { cfg, missing } = readConfig();
if (missing.length) {
  console.log(`drive: not configured (${missing.join(', ')} unset) — local backup only.`);
  console.log('drive: see server/README.md, "Off-box backups", to switch it on.');
  process.exit(0);
}

const MIME = { '.db': 'application/x-sqlite3', '.gz': 'application/gzip' };

try {
  const token = await accessToken(cfg);
  const folderId = cfg.folderId || await ensureFolder(token, cfg.folderName);
  if (!cfg.folderId) console.log(`drive: folder id ${folderId} (set DRIVE_BACKUP_FOLDER_ID to skip the lookup)`);

  const todays = (await readdir(dir)).filter(f => f.includes(stamp));
  if (!todays.length) {
    console.log(`drive: nothing named ${stamp} in ${dir} — nothing uploaded.`);
    process.exit(0);
  }

  for (const name of todays) {
    const body = await readFile(join(dir, name));
    const ext = name.slice(name.lastIndexOf('.'));
    const up = await uploadFile(token, { name, folderId, body, mimeType: MIME[ext] ?? 'application/octet-stream' });
    console.log(`drive: uploaded ${up.name} (${body.length} bytes)`);
  }

  // Pruned only AFTER a successful upload, so a failed run never leaves
  // Drive emptier than it found it.
  const remote = await listBackups(token, folderId);
  for (const f of expiredBackups(remote, keepDays)) {
    await deleteFile(token, f.id);
    console.log(`drive: pruned ${f.name}`);
  }
} catch (err) {
  // Exit 0 on purpose. The local backup already succeeded by the time this
  // runs, and failing here would mark the whole nightly job as failed and
  // train everyone to ignore it.
  console.error(`drive: upload failed — ${err.message}`);
  console.error('drive: the LOCAL backup is unaffected. Fix and re-run: bash server/backup-db.sh');
  process.exit(0);
}
