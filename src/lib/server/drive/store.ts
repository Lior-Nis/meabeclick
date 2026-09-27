/**
 * drive_items — see migration 019. One row per Drive file the app owns.
 */
import { handle } from '../db.ts';

export type DriveKind = 'root' | 'student' | 'index' | 'lesson';

export interface DriveItem {
  key: string;
  fileId: string;
  kind: DriveKind;
  syncedVersion: number | null;
  syncedModified: string | null;
  /** sha256 of Drive's export after our last write or read (migration 020). */
  syncedHash?: string | null;
  /** Why her Drive edit could not be read; nothing is pushed while set. */
  blocked?: string | null;
}

type Row = {
  key: string; file_id: string; kind: DriveKind; synced_version: number | null; synced_modified: string | null;
  synced_hash: string | null; blocked: string | null;
};
const toItem = (r: Row): DriveItem => ({
  key: r.key, fileId: r.file_id, kind: r.kind, syncedVersion: r.synced_version, syncedModified: r.synced_modified,
  syncedHash: r.synced_hash, blocked: r.blocked,
});

export function getItem(key: string): DriveItem | null {
  const r = handle().prepare(`SELECT * FROM drive_items WHERE key = ?`).get(key) as Row | undefined;
  return r ? toItem(r) : null;
}

export function allItems(): DriveItem[] {
  return (handle().prepare(`SELECT * FROM drive_items ORDER BY key`).all() as Row[]).map(toItem);
}

/** Insert or replace by key: a key names one file, so a second write is an
 *  update (a recreated file gets the new id), never a second row. */
export function putItem(i: DriveItem): void {
  handle().prepare(`
    INSERT INTO drive_items (key, file_id, kind, synced_version, synced_modified, synced_hash, blocked, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET file_id = excluded.file_id, kind = excluded.kind,
      synced_version = excluded.synced_version, synced_modified = excluded.synced_modified,
      synced_hash = excluded.synced_hash, blocked = excluded.blocked, updated_at = excluded.updated_at
  `).run(i.key, i.fileId, i.kind, i.syncedVersion, i.syncedModified, i.syncedHash ?? null, i.blocked ?? null,
         new Date().toISOString());
}
