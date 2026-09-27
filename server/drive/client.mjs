/**
 * The smallest Google Drive client this needs, and no dependency.
 *
 * ## Why OAuth as a person, and not the service account we already have
 *
 * The repo already carries a service account for Calendar, and reusing it
 * would have been free. It cannot work here: a service account has NO Drive
 * storage quota and cannot own files. Google's own guidance is to use a
 * shared drive or OAuth on behalf of a user, and a shared drive requires
 * Workspace — mea.beclick@gmail.com is a consumer account. An upload by the
 * service account fails with 403 storageQuotaExceeded even into a folder
 * shared with it, because ownership, not permission, is what it lacks.
 *
 * So this authenticates as the business account itself. The backups are then
 * owned by mea.beclick@gmail.com, which is also what makes them survive this
 * app: they are visible in that account's own Drive, restorable by a human
 * with no code at all.
 *
 * ## Scope
 *
 * `drive.file` — access limited to files this application creates. It cannot
 * read the account's existing Drive, which is the point: a leaked refresh
 * token exposes the backups it made and nothing else. It also means the
 * backup folder must be created BY this client and its id remembered; the
 * app is blind to a folder made by hand in the browser.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Never interpolated into an error, a log line, or a thrown message. */
export function readConfig(env = process.env) {
  const cfg = {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
    folderId: env.DRIVE_BACKUP_FOLDER_ID || null,
    folderName: env.DRIVE_BACKUP_FOLDER || 'mea-beclick-backups',
  };
  const missing = ['clientId', 'clientSecret', 'refreshToken'].filter(k => !cfg[k]);
  return { cfg, missing };
}

/** Exchanges the long-lived refresh token for a short-lived access token. */
export async function accessToken({ clientId, clientSecret, refreshToken }, fetchImpl = fetch) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    // Body deliberately not echoed: it can carry the client_id back.
    throw new Error(`drive auth failed: ${res.status} — check the refresh token has not been revoked`);
  }
  return (await res.json()).access_token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * Finds or creates the backup folder, returning its id.
 *
 * Idempotent by search-then-create rather than create-blindly: a nightly job
 * that made a new folder on every run would scatter backups across dozens of
 * identically-named folders, and drive.file means nobody could tidy them up
 * from the browser without losing the app's access.
 */
export async function ensureFolder(token, name, fetchImpl = fetch) {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
  );
  const found = await fetchImpl(`${API}/files?q=${q}&fields=files(id,name)`, { headers: auth(token) });
  if (found.ok) {
    const { files } = await found.json();
    if (files?.length) return files[0].id;
  }
  const created = await fetchImpl(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!created.ok) throw new Error(`could not create Drive folder: ${created.status}`);
  return (await created.json()).id;
}

/** Multipart upload: metadata and bytes in one request. */
export async function uploadFile(token, { name, folderId, body, mimeType }, fetchImpl = fetch) {
  const boundary = `mbc-${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name, parents: folderId ? [folderId] : undefined });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);

  const res = await fetchImpl(`${UPLOAD}?uploadType=multipart&fields=id,name,size`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([head, body, tail]),
  });
  if (!res.ok) {
    const hint = res.status === 403
      ? ' — 403 here is usually storageQuotaExceeded: a service account cannot own Drive files, this must run as a user'
      : '';
    throw new Error(`upload of ${name} failed: ${res.status}${hint}`);
  }
  return res.json();
}

/** Files this app put in the folder, oldest first. */
export async function listBackups(token, folderId, fetchImpl = fetch) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await fetchImpl(`${API}/files?q=${q}&orderBy=createdTime&fields=files(id,name,createdTime,size)&pageSize=1000`, {
    headers: auth(token),
  });
  if (!res.ok) throw new Error(`could not list Drive backups: ${res.status}`);
  return (await res.json()).files ?? [];
}

/**
 * The bytes of one backup, by file id.
 *
 * The other half of `uploadFile`. Without it the off-box copy was
 * write-only: `server/README.md` says the Drive copy is what makes this VPS
 * disposable — "rebuild the box, restore from Drive, carry on" — while
 * nothing in the tree could fetch a file back. A backup that cannot be
 * downloaded is a claim, not a backup.
 *
 * `alt=media` returns the file itself rather than its metadata.
 */
export async function downloadFile(token, id, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/files/${id}?alt=media`, { headers: auth(token) });
  if (!res.ok) throw new Error(`could not download ${id}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteFile(token, id, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/files/${id}`, { method: 'DELETE', headers: auth(token) });
  if (!res.ok && res.status !== 404) throw new Error(`could not delete ${id}: ${res.status}`);
}

/**
 * Which of `files` to remove so that only the newest `keep` DAYS remain.
 *
 * Pure, and separated from the API for one reason: this is the only function
 * here that can destroy a backup, and a retention bug is silent until the
 * day it matters. Grouping by the date in the NAME rather than counting
 * files keeps a day whose upload produced two artefacts (database and
 * tarball) from counting as two days and evicting a real one.
 */
export function expiredBackups(files, keepDays, today = new Date()) {
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const stamp = (n) => n.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  return files.filter(f => {
    const s = stamp(f.name);
    return s !== null && new Date(`${s}T00:00:00Z`) < cutoff;
  });
}
