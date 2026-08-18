import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  completePasswordReset,
  InvalidResetTokenError,
  requestPasswordReset,
} from '@/lib/auth/password-reset';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimitShared,
} from '@/lib/api/guard';

/**
 * Password reset request and confirmation.
 *
 * Both actions use the shared limiter: this endpoint can send mail and can
 * change a credential, so the budget must hold across replicas rather than
 * per process.
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), email: z.string().email().max(320) }),
  z.object({
    action: z.literal('confirm'),
    token: z.string().min(32).max(200),
    password: z.string().min(12).max(200),
  }),
]);

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    await rateLimitShared(`password-reset:${ip}`, 5);

    const body = await parseBody(req, bodySchema);

    if (body.action === 'request') {
      await requestPasswordReset(body.email);

      // The same response whether or not the address exists. Anything else
      // turns this into an account-enumeration oracle. The token is never
      // returned to the caller — it travels only by email.
      return NextResponse.json({
        ok: true,
        message:
          'If that address has an account, a reset link has been sent to it.',
      });
    }

    await completePasswordReset(body.token, body.password);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InvalidResetTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleRouteError(error, 'POST /api/auth/password-reset');
  }
}
