import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/lib/env';

/**
 * Session handling.
 *
 * The previous build's /api/auth verified the password and then returned the
 * user object — and nothing else. No cookie, no token, no session. Every route
 * therefore fell back to a hardcoded `userId = 'demo-user'`, which meant all
 * data belonged to one shared tenant and "logging in" changed nothing.
 *
 * Sessions are stateless signed JWTs in an httpOnly cookie: no session table to
 * keep in sync, and rotating AUTH_SECRET logs everyone out at once.
 */

export const SESSION_COOKIE = 'tasami_session';

export interface SessionPayload {
  userId: string;
  email: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const ttlHours = env().SESSION_TTL_HOURS;

  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlHours}h`)
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
    });

    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      return null;
    }

    return { userId: payload.sub, email: payload.email };
  } catch {
    // Expired, tampered with, or signed by a rotated secret.
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Not readable from JS, not sent cross-site, HTTPS-only in production.
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: env().SESSION_TTL_HOURS * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/** Returns the caller's session, or null when unauthenticated. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
