import { env } from '@/lib/env';
import { requireUser } from '@/lib/api/guard';
import type { SessionPayload } from './session';

/** Raised when a signed-in user is not an owner. */
export class ForbiddenError extends Error {
  constructor() {
    super('Not permitted.');
    this.name = 'ForbiddenError';
  }
}

/** True when this email is listed in ADMIN_EMAILS. Case-insensitive. */
export function isAdminEmail(email: string): boolean {
  const raw = env().ADMIN_EMAILS;
  if (!raw) return false;

  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}

/**
 * Owner-only gate.
 *
 * Fails closed: with ADMIN_EMAILS unset, `isAdminEmail` is false for everyone
 * and the admin area is unreachable rather than open to the first person who
 * finds the URL.
 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireUser();
  if (!isAdminEmail(session.email)) throw new ForbiddenError();
  return session;
}
