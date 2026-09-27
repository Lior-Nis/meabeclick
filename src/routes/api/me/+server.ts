/**
 * Direct port of server/auth.mjs's `mountAuth` GET /api/me handler.
 * Unauthenticated and always 200 — the harness polls this to know the
 * server is up (see tests/characterization/harness.mjs).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json({ authenticated: locals.authenticated });
