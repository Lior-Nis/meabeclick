/**
 * The app's Google Drive client — the handful of calls the lesson sync
 * needs, as the production probe of 2026-09-25 exercised them (spec §1).
 *
 * The login is the one the nightly backups already use (mea.beclick@
 * gmail.com, scope drive.file); the token exchange is imported from the
 * backup client rather than written a second time.
 *
 * Errors carry the HTTP status and nothing from Google's body, which can
 * echo request details into a log.
 */
import { accessToken, readConfig } from '../../../../server/drive/client.mjs';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DOC = 'application/vnd.google-apps.document';
const FOLDER = 'application/vnd.google-apps.folder';
/** Google's access tokens last an hour; renew well before. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

export interface DriveApi {
  createFolder(name: string, parentId: string | null): Promise<{ id: string; modifiedTime: string }>;
  createDoc(name: string, html: string, parentId: string): Promise<{ id: string; modifiedTime: string }>;
  updateDoc(id: string, html: string): Promise<{ modifiedTime: string }>;
  /** Null when the file is gone. A trashed file is reported, not hidden. */
  meta(id: string): Promise<{ modifiedTime: string; trashed: boolean } | null>;
  exportMarkdown(id: string): Promise<string>;
  /** The file's name in Drive — a lesson's title, kept in step with it. */
  rename(id: string, name: string): Promise<void>;
}

type Config = { clientId: string; clientSecret: string; refreshToken: string };

/** Null when the login is not configured — tests, the characterization
 *  harness, a fresh box. The sync then does nothing (spec D6). */
export function driveApiFromEnv(env: Record<string, string | undefined> = process.env): DriveApi | null {
  const { cfg, missing } = readConfig(env);
  return missing.length ? null : driveApi(cfg as Config);
}

export function driveApi(cfg: Config, fetchImpl: typeof fetch = fetch): DriveApi {
  let token: { value: string; until: number } | null = null;

  async function call(label: string, url: string, init: RequestInit = {}, allow404 = false): Promise<Response | null> {
    if (!token || Date.now() > token.until) {
      token = { value: await accessToken(cfg, fetchImpl), until: Date.now() + TOKEN_TTL_MS };
    }
    const res = await fetchImpl(url, {
      ...init, headers: { ...(init.headers as Record<string, string> ?? {}), Authorization: `Bearer ${token.value}` },
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) throw new Error(`drive ${label} failed: ${res.status}`);
    return res;
  }

  function multipart(metadata: object, html: string): { body: string; type: string } {
    const b = `mb${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return {
      type: `multipart/related; boundary=${b}`,
      body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
        + `--${b}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${b}--`,
    };
  }

  return {
    async createFolder(name, parentId) {
      const res = await call('create folder', `${API}?fields=id,modifiedTime`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER, ...(parentId ? { parents: [parentId] } : {}) }),
      });
      return (await res!.json()) as { id: string; modifiedTime: string };
    },
    async createDoc(name, html, parentId) {
      const m = multipart({ name, mimeType: DOC, parents: [parentId] }, html);
      const res = await call('create doc', `${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, {
        method: 'POST', headers: { 'Content-Type': m.type }, body: m.body,
      });
      return (await res!.json()) as { id: string; modifiedTime: string };
    },
    async updateDoc(id, html) {
      const res = await call('update doc', `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`, {
        method: 'PATCH', headers: { 'Content-Type': 'text/html; charset=UTF-8' }, body: html,
      });
      const { modifiedTime } = (await res!.json()) as { modifiedTime: string };
      return { modifiedTime };
    },
    async meta(id) {
      const res = await call('meta', `${API}/${encodeURIComponent(id)}?fields=modifiedTime,trashed`, {}, true);
      return res ? ((await res.json()) as { modifiedTime: string; trashed: boolean }) : null;
    },
    async rename(id, name) {
      await call('rename', `${API}/${encodeURIComponent(id)}?fields=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
    },
    async exportMarkdown(id) {
      const res = await call('export', `${API}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent('text/markdown')}`);
      return res!.text();
    },
  };
}
