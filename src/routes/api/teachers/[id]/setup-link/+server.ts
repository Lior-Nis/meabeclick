/**
 * The link the owner sends a tutor on WhatsApp, to connect their Meet room.
 * Minting replaces the tutor's previous link. See $server/tutor-setup.ts.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { getTeacher } from '$server/entities.ts';
import { mintSetupCode, setupLink } from '$server/tutor-setup.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const id = Number(event.params.id);
  const teacher = Number.isInteger(id) && id > 0 ? getTeacher(id) : null;
  if (!teacher?.active) return json({ error: 'teacher not found' }, { status: 404 });
  return json({ link: setupLink(mintSetupCode(teacher.id)) }, { headers: { 'Cache-Control': 'no-store' } });
};
