/**
 * Client-safe URL helpers shared by every /app/* page that renders a
 * portal/lesson `url` field.
 *
 * Ruling P13: a game/homework `url` reaching the client is permanently
 * mixed-shape, and the two shapes disagree on whether they already carry a
 * leading slash. An old-shape entry is the raw string baked by the retired
 * server/lesson-queue.mjs ("games/memory.html?d=...") — no leading slash.
 * A new-shape entry's `url` was derived by src/lib/server/urls.ts's
 * gameUrl(), which always returns an absolute path ("/app/play/...") —
 * already has one.
 *
 * Blindly prepending "/" (what the old pages/app/*.html always did) is
 * correct for the old shape and wrong for the new one — from a page under
 * /app/*, `href="/${'/app/play/...'}"` doesn't error, it just resolves to
 * a real but WRONG url ("/app/play/...` relative-joined again), a third
 * silent-failure mode P13 exists to rule out, not just the two named in the
 * ruling (unguarded-undefined and silently-no-link). toHref() is the one
 * place that reconciles both shapes — import this rather than writing a
 * second copy; that duplication is exactly what let dashboard/+page.svelte
 * miss it the first time this was fixed in parent/ and student/.
 *
 * Contract: `url` must be one of the two SAME-ORIGIN shapes above — a
 * root-absolute path ("/app/play/...") or a bare relative one
 * ("games/....html?..."), always non-empty in practice (both shapes are
 * built from a template/dataId that already passed assertPathSegment in
 * src/lib/server/urls.ts, which rejects empty strings). Two inputs this
 * function does NOT special-case, because no caller has ever produced
 * either: an empty string resolves to "/" (silently wrong, not a real
 * link, but also not a crash); a full external URL ("https://...") would
 * be mangled into "/https://..." rather than left alone, since it happens
 * to already satisfy neither prefix check. Every current and Task 19/20
 * call site only ever passes a stored game/homework `url`, never
 * user-supplied or external input, so this has not needed tightening —
 * documented here so a future caller with a looser input notices before
 * relying on it.
 */
export function toHref(url: string): string {
  return url.startsWith('/') ? url : `/${url}`;
}
