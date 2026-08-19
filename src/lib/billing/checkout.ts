import { CheckoutStatus, type CheckoutSession } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { findCatalogPlan } from './catalog';
import { evaluateOffer } from './offers';
import { getProvider } from './index';

/**
 * Checkout orchestration.
 *
 * The security property this file exists to hold: **the client chooses a plan
 * code and an interval, and nothing else.** Amount, currency, plan identity
 * and any promotional price are resolved here from the catalog and the
 * database. A request carrying `amount=1` is not rejected — it is simply never
 * read.
 */

export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export interface StartCheckoutInput {
  userId: string;
  planCode: string;
  interval: 'MONTH' | 'YEAR';
  offerCode?: string;
  /** Supplied by the client purely to deduplicate its own retries. */
  idempotencyKey: string;
}

export interface StartCheckoutResult {
  checkoutId: string;
  approvalUrl: string;
  /** Echoed for display only; the charge uses the server-resolved value. */
  amount: number;
  currency: string;
  reused: boolean;
}

export async function startCheckout(
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  // 1. Resolve the plan from trusted configuration.
  const catalogPlan = findCatalogPlan(input.planCode);
  if (!catalogPlan) throw new CheckoutError('Unknown plan.');

  const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
  if (!plan || !plan.active) throw new CheckoutError('Plan is not available.');

  const price = await prisma.price.findFirst({
    where: { planId: plan.id, interval: input.interval, active: true },
  });
  if (!price) throw new CheckoutError('No active price for that interval.');

  // 2. Resolve the amount. The offer, if any, is validated server-side.
  let amount = price.amount;
  let currency = price.currency;
  let appliedOffer: string | undefined;

  if (input.offerCode) {
    const evaluation = await evaluateOffer(
      input.offerCode,
      input.userId,
      input.planCode,
    );

    if (evaluation.eligible && evaluation.amount !== undefined) {
      amount = evaluation.amount;
      currency = evaluation.currency ?? currency;
      appliedOffer = input.offerCode;
    }
    // An ineligible offer is silently dropped rather than failing checkout:
    // the customer still gets to buy, at list price.
  }

  // 3. Idempotency. A double-click, a browser retry or a refresh returns the
  //    original session instead of creating a second order.
  const existing = await prisma.checkoutSession.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });

  if (existing?.providerApprovalUrl && existing.status === CheckoutStatus.CREATED) {
    return {
      checkoutId: existing.id,
      approvalUrl: existing.providerApprovalUrl,
      amount: existing.amount,
      currency: existing.currency,
      reused: true,
    };
  }

  const provider = getProvider();
  const appUrl = env().NEXT_PUBLIC_APP_URL;

  const session = await prisma.checkoutSession.upsert({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    create: {
      userId: input.userId,
      priceId: price.id,
      planCode: plan.code,
      offerCode: appliedOffer ?? null,
      provider: provider.name,
      currency,
      amount,
      idempotencyKey: input.idempotencyKey,
      status: CheckoutStatus.CREATED,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    update: { currency, amount, status: CheckoutStatus.CREATED },
  });

  // 4. Create the provider order with the server-resolved amount.
  const order = await provider.createCheckout({
    userId: input.userId,
    planCode: plan.code,
    interval: input.interval,
    currency,
    amount,
    offerCode: appliedOffer,
    returnUrl: `${appUrl}/billing/return?checkout=${session.id}`,
    cancelUrl: `${appUrl}/pricing?checkout=cancelled`,
    idempotencyKey: input.idempotencyKey,
  });

  const updated = await prisma.checkoutSession.update({
    where: { id: session.id },
    data: {
      providerOrderId: order.providerOrderId,
      providerApprovalUrl: order.approvalUrl,
    },
  });

  logger.info('Checkout created', {
    checkoutId: updated.id,
    userId: input.userId,
    planCode: plan.code,
    interval: input.interval,
    offerApplied: Boolean(appliedOffer),
  });

  return {
    checkoutId: updated.id,
    approvalUrl: order.approvalUrl,
    amount,
    currency,
    reused: false,
  };
}

/**
 * Looks up a checkout the caller owns.
 *
 * Used by the return page, which must be able to say "we are waiting for
 * confirmation" — and must not be able to grant access itself.
 */
export async function getOwnedCheckout(
  checkoutId: string,
  userId: string,
): Promise<CheckoutSession | null> {
  return prisma.checkoutSession.findFirst({
    where: { id: checkoutId, userId },
  });
}
