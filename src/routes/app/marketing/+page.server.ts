/**
 * The tutor's "שיווק" report — spec §"Surfaces" → /app/marketing
 * (docs/superpowers/specs/2026-09-24-marketing-funnel-design.md). Tutor
 * only, guarded exactly like src/routes/app/dashboard/+page.server.ts:
 * requireAuth() throws a 302 to /login for anyone without a session — see
 * that file's own comment for why this is a page route and not apiAuthDenied.
 *
 * Everything the page needs is computed here rather than fetched after
 * mount, same reasoning as app/plan/[code]/+page.server.ts: the funnel table
 * is the whole point of the page, and a spinner in front of it buys nothing.
 */
import { requireAuth } from '$server/auth.ts';
import { funnel, heardFromCounts, distinctVisitors, type FunnelRow } from '$server/marketing.ts';
import type { PageServerLoad } from './$types';

/** The spec's own toggle: 7 / 30 / 90 days, defaulting to 7. Anything else
 *  in `?days=` — missing, non-numeric, or a value not in this set — falls
 *  back to 7 rather than erroring; a mistyped or hand-edited query string
 *  must never break the page. */
const ALLOWED_DAYS: ReadonlySet<number> = new Set([7, 30, 90]);
const DEFAULT_DAYS = 7;

function parseDays(raw: string | null): number {
  const n = Number(raw);
  return ALLOWED_DAYS.has(n) ? n : DEFAULT_DAYS;
}

/**
 * Sorts funnel() rows so same-source rows sit together, then same-campaign
 * rows within a source, matching the spec's "grouped by source, then
 * campaign, then content" — funnel()'s own GROUP BY already collapses each
 * (source, campaign, content) triple to one row, but SQLite makes no promise
 * about the ORDER those rows come back in.
 *
 * A NULL source sorts after every real one ("ישיר / לא מתויג" reads as a
 * catch-all bucket, not the headline row), and NULL campaign/content sort
 * before a named value within the same source so the "whole source, no
 * campaign" row leads that source's group.
 */
function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function sortRows(rows: FunnelRow[]): FunnelRow[] {
  return [...rows].sort((a, b) =>
    compareNullable(a.source, b.source)
    || compareNullable(a.campaign, b.campaign)
    || compareNullable(a.content, b.content));
}

export const load: PageServerLoad = async (event) => {
  requireAuth(event);

  const days = parseDays(event.url.searchParams.get('days'));

  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();

  const rows = sortRows(funnel(sinceIso, untilIso));
  const heardFrom = heardFromCounts(sinceIso, untilIso);
  // The summary tile's visitor count — a true COUNT(DISTINCT visitor_id)
  // over the whole window, not a sum of funnel()'s per-UTM-group distinct
  // counts (which double-counts a visitor who appears under two groups).
  // See distinctVisitors's own doc comment.
  const visitors = distinctVisitors(sinceIso, untilIso);

  return { days, rows, heardFrom, visitors, sinceIso, untilIso };
};
