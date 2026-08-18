import nodemailer from 'nodemailer';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Outbound delivery.
 *
 * Deliberately fails closed. With OUTREACH_TRANSPORT unset (the default), a
 * dispatch attempt raises instead of quietly succeeding — an approval can
 * never reach SENT unless a real transport actually accepted the message.
 */

export class TransportNotConfiguredError extends Error {
  constructor() {
    super(
      'No outbound transport is configured. Set OUTREACH_TRANSPORT=smtp and SMTP_URL to enable sending.',
    );
    this.name = 'TransportNotConfiguredError';
  }
}

export interface DispatchRequest {
  approvalId: string;
  channel: string | null;
  recipient: string | null;
  content: string;
}

export interface DispatchResult {
  transport: string;
  providerRef: string | null;
}

let cachedTransporter: nodemailer.Transporter | null = null;

function smtpTransporter(): nodemailer.Transporter {
  if (!cachedTransporter) {
    const url = env().SMTP_URL;
    if (!url) throw new TransportNotConfiguredError();
    cachedTransporter = nodemailer.createTransport(url);
  }
  return cachedTransporter;
}

export async function dispatchOutbound(
  request: DispatchRequest,
): Promise<DispatchResult> {
  const config = env();

  if (config.OUTREACH_TRANSPORT === 'none') {
    throw new TransportNotConfiguredError();
  }

  if (!request.recipient) {
    throw new Error('Approval has no recipient; cannot dispatch.');
  }

  if (!request.content.trim()) {
    throw new Error('Approval has no content to send.');
  }

  if (!config.OUTREACH_FROM) {
    throw new Error('OUTREACH_FROM must be set to send outbound mail.');
  }

  const info = await smtpTransporter().sendMail({
    from: config.OUTREACH_FROM,
    to: request.recipient,
    subject: `Tasami outreach`,
    text: request.content,
  });

  logger.info('Outbound message dispatched', {
    approvalId: request.approvalId,
    transport: 'smtp',
  });

  return { transport: 'smtp', providerRef: info.messageId ?? null };
}

/** Lets the UI show whether sending is possible before an item is approved. */
export function isOutreachConfigured(): boolean {
  return env().OUTREACH_TRANSPORT !== 'none';
}

/**
 * Password-reset delivery.
 *
 * Uses the same SMTP transport as outreach. When no transport is configured
 * this logs that delivery was skipped and returns without throwing: a reset
 * request must not 500 on a development install, and the account state (the
 * stored token) is already correct. The reset URL is logged only outside
 * production, and the token itself never reaches the audit trail.
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}): Promise<{ delivered: boolean }> {
  const config = env();

  if (config.OUTREACH_TRANSPORT === 'none' || !config.OUTREACH_FROM) {
    logger.warn('Password reset email not sent: no transport configured', {
      hasTransport: config.OUTREACH_TRANSPORT !== 'none',
    });

    if (config.NODE_ENV !== 'production') {
      // Development convenience only. Never enabled in production, where this
      // line would put a working credential in the log.
      logger.info('Password reset link (development only)', {
        resetUrl: params.resetUrl,
      });
    }

    return { delivered: false };
  }

  await smtpTransporter().sendMail({
    from: config.OUTREACH_FROM,
    to: params.to,
    subject: 'إعادة تعيين كلمة المرور — Tasami',
    text: `لإعادة تعيين كلمة المرور، افتح الرابط التالي خلال 30 دقيقة:\n\n${params.resetUrl}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.`,
  });

  return { delivered: true };
}
