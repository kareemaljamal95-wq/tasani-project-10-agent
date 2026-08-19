import { NextResponse } from 'next/server';
import { processWebhook } from '@/lib/billing/webhook';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * PayPal webhook endpoint.
 *
 * Deliberately unauthenticated in the session sense — PayPal has no cookie.
 * Authenticity comes from signature verification against PayPal's own
 * verification API, and the handler fails closed: an unverified payload never
 * reaches billing state.
 *
 * Status codes matter to the provider's retry behaviour:
 *   401 — verification failed. PayPal should not retry a forged request.
 *   200 — accepted, including duplicates and events we correctly ignore.
 *   500 — our fault; PayPal retries, and idempotency makes that safe.
 */
export async function POST(req: Request) {
  // The raw body is required: verification is over the exact bytes sent, so
  // re-serialising parsed JSON would change them and fail every time.
  const rawBody = await req.text();

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  try {
    const outcome = await processWebhook(rawBody, headers);

    if (outcome.status === 'rejected') {
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
    }

    // Duplicates and unhandled types are accepted so the provider stops
    // retrying something we have deliberately decided about.
    return NextResponse.json({ received: true, outcome: outcome.status });
  } catch (error) {
    logger.error('Billing webhook handler failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    // 500 so the provider retries; the event id claim makes the retry safe.
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
  }
}
