/**
 * Types for the parts of client.mjs the app imports (src/lib/server/drive/
 * api.ts). client.mjs stays plain JS — it also runs on the host, outside
 * the build, for the backups — and this file is the typed boundary, so
 * importing it does not pull untyped JS into the app's type check.
 */
export interface DriveConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  refreshToken: string | undefined;
  folderId: string | null;
  folderName: string;
}

export const DRIVE_SCOPE: string;

export function readConfig(env?: Record<string, string | undefined>): { cfg: DriveConfig; missing: string[] };

export function accessToken(
  cfg: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl?: typeof fetch,
): Promise<string>;

export interface DriveFile { id: string; name: string; createdTime: string; size?: string }

export function findFolder(token: string, name: string, fetchImpl?: typeof fetch): Promise<string | null>;

export function listBackups(token: string, folderId: string, fetchImpl?: typeof fetch): Promise<DriveFile[]>;
