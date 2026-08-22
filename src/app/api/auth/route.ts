import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import {
  clearSessionCookie,
  createSessionToken,
  getSession,
  setSessionCookie,
} from '@/lib/auth/session';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimitShared,
} from '@/lib/api/guard';
import { recordAudit } from '@/lib/audit';
import { track } from '@/lib/analytics';

/**
 * Authentication.
 *
 * Rewritten from a version that hashed passwords correctly but never issued a
 * session, so a successful login left the caller just as anonymous as before.
 */

const credentialsSchema = z.object({
  action: z.enum(['register', 'login', 'logout']),
  email: z.string().email().max(320).optional(),
  password: z.string().min(12).max(200).optional(),
  name: z.string().min(1).max(120).optional(),
});

/** Generic message for both "no such user" and "wrong password". */
const INVALID_CREDENTIALS = 'Invalid email or password.';

export async function POST(req: Request) {
  try {
    // Auth endpoints get a tighter budget than the rest of the API: this is
    // the surface a credential-stuffing run would target.
    // Postgres-backed, not the in-process counter: this is the
    // credential-stuffing surface, so the budget has to hold across replicas
    // and survive a restart. Every other sensitive route already used the
    // shared limiter; auth was the one that slipped through on the local one,
    // where an attacker regains a full budget whenever the process recycles.
    await rateLimitShared(`auth:${clientIp(req)}`, env().AUTH_RATE_LIMIT_MAX);

    const body = await parseBody(req, credentialsSchema);

    if (body.action === 'logout') {
      await clearSessionCookie();
      return NextResponse.json({ ok: true });
    }

    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: 'Email and password are required.' },
        { status: 400 },
      );
    }

    const email = body.email.trim().toLowerCase();

    if (body.action === 'register') {
      const existing = await prisma.user.findUnique({ where: { email } });

      if (existing) {
        // Do not confirm which addresses are registered.
        return NextResponse.json(
          { error: 'Unable to register with those details.' },
          { status: 400 },
        );
      }

      const hashedPassword = await bcrypt.hash(body.password, 12);

      const user = await prisma.user.create({
        data: { email, password: hashedPassword, name: body.name ?? null },
      });

      const token = await createSessionToken({ userId: user.id, email: user.email });
      await setSessionCookie(token);

      await recordAudit({
        type: 'auth_succeeded',
        message: 'New account registered.',
        userId: user.id,
        actor: user.email,
      });

      track('signup', { userId: user.id });
      logger.info('User registered', { userId: user.id });

      return NextResponse.json({
        user: { id: user.id, email: user.email, name: user.name },
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Hash even when the user is unknown so the response time does not reveal
    // whether the address exists.
    const storedHash =
      user?.password ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const valid = await bcrypt.compare(body.password, storedHash);

    if (!user || !user.password || !valid) {
      await recordAudit({
        type: 'auth_failed',
        message: 'Failed login attempt.',
        data: { ip: clientIp(req) },
      });

      logger.warn('Failed login attempt', { ip: clientIp(req) });

      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
    }

    const token = await createSessionToken({ userId: user.id, email: user.email });
    await setSessionCookie(token);

    await recordAudit({
      type: 'auth_succeeded',
      message: 'Successful login.',
      userId: user.id,
      actor: user.email,
    });

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    return handleRouteError(error, 'POST /api/auth');
  }
}

/** Lets the client discover whether it is signed in, without exposing the JWT. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ user: null }, { status: 200 });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, name: true, language: true, theme: true },
    });

    return NextResponse.json({ user });
  } catch (error) {
    return handleRouteError(error, 'GET /api/auth');
  }
}
