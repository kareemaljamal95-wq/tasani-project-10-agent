import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startCheckout, CheckoutError } from '@/lib/billing/checkout';
import { getProvider } from '@/lib/billing';
import { ProviderCapabilityError } from '@/lib/billing/provider';
import {
  handleRouteError,
  parseBody,
  rateLimitShared,
  requireUser,
} from '@/lib/api/guard';

/**
 * Starts a checkout.
 *
 * The schema is the security boundary: the client may name a plan and an
 * interval, and may pass an idempotency key for its own retries. It cannot
 * pass an amount, a currency, a price id or a subscription status, because
 * there is nowhere in this shape to put one.
 */
const checkoutSchema = z.object({
  planCode: z.enum(['starter', 'growth', 'scale']),
  interval: z.enum(['MONTH', 'YEAR']),
  offerCode: z.string().min(1).max(64).optional(),
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    await rateLimitShared(`checkout:${session.userId}`, 10);

    const body = await parseBody(req, checkoutSchema);

    const result = await startCheckout({
      userId: session.userId,
      planCode: body.planCode,
      interval: body.interval,
      offerCode: body.offerCode,
      idempotencyKey: body.idempotencyKey,
    });

    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof ProviderCapabilityError) {
      // The payment provider is not usable in this deployment. That is an
      // operator problem, reported as such, not a customer error.
      return NextResponse.json(
        {
          error: 'Payments are not available yet. Please try again shortly.',
          capability: error.capability,
        },
        { status: 503 },
      );
    }

    return handleRouteError(error, 'POST /api/billing/checkout');
  }
}

/** Reports what the configured provider can actually do. Signed-in only. */
export async function GET() {
  try {
    await requireUser();
    const capabilities = await getProvider().capabilities();
    return NextResponse.json({ provider: getProvider().name, capabilities });
  } catch (error) {
    return handleRouteError(error, 'GET /api/billing/checkout');
  }
}
