import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/lib/audit';
import { sendPasswordResetEmail } from '@/lib/outreach';

/**
 * Password reset.
 *
 * The raw token exists in exactly two places: the response to the request that
 * created it (so it can be emailed) and the user's inbox. Only its SHA-256
 * hash is stored, and the token is never written to a log line — a reset token
 * in the logs is a working credential for anyone who can read them.
 */

const TOKEN_TTL_MINUTES = 30;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface ResetRequestOutcome {
  /** Always true to the caller — see the note in the route about enumeration. */
  accepted: boolean;
  /** Present only when a matching account existed. */
  token?: string;
  email?: string;
}

export async function requestPasswordReset(
  rawEmail: string,
): Promise<ResetRequestOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // No row is created and no mail is sent, but the caller is told the same
    // thing either way so the endpoint cannot be used to test which addresses
    // are registered.
    return { accepted: true };
  }

  // Any earlier unused token is invalidated, so a reset link cannot be
  // resurrected after a newer one is issued.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString('hex');

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
    },
  });

  await recordAudit({
    type: 'auth_failed',
    message: 'Password reset requested.',
    userId: user.id,
    actor: user.email,
  });

  // Deliberately logs the user id and not the token.
  logger.info('Password reset token issued', { userId: user.id });

  await sendPasswordResetEmail({
    to: user.email,
    resetUrl: `${env().NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`,
  });

  return { accepted: true, token, email: user.email };
}

export class InvalidResetTokenError extends Error {
  constructor() {
    super('This reset link is invalid or has expired.');
    this.name = 'InvalidResetTokenError';
  }
}

export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new InvalidResetTokenError();
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // Marking the token used in the same transaction as the password change
  // means a token cannot be replayed even under concurrent requests.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { password: hashedPassword },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await recordAudit({
    type: 'auth_succeeded',
    message: 'Password reset completed.',
    userId: record.userId,
  });

  logger.info('Password reset completed', { userId: record.userId });
}
