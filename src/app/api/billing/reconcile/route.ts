import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { reconcileCheckout } from '@/lib/billing/checkout';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Settles a checkout against the provider.
 *
 * Called by the return page while it waits. The session decides which checkout
 * may be examined; whether money moved is answered by PayPal, not by the
 * caller — so this cannot be used to self-grant access. A checkout belonging to
 * someone else reads as not-found, like every other resource here.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let checkoutId: unknown;
  try {
    ({ checkoutId } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  if (typeof checkoutId !== 'string' || checkoutId.length === 0) {
    return NextResponse.json({ error: 'checkoutId is required.' }, { status: 400 });
  }

  try {
    const outcome = await reconcileCheckout(checkoutId, session.userId);

    if (outcome === 'not-found') {
      return NextResponse.json({ error: 'Checkout not found.' }, { status: 404 });
    }

    return NextResponse.json({ outcome });
  } catch (error) {
    logger.error('Checkout reconciliation failed', {
      userId: session.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    // 502: the provider could not be reached or refused. The customer's money
    // is not in question here — our ability to ask about it is.
    return NextResponse.json(
      { error: 'Could not confirm the payment with the provider.' },
      { status: 502 },
    );
  }
}
