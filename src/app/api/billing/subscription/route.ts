import { NextResponse } from 'next/server';
import { SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getEntitlements, getActiveSubscription } from '@/lib/billing/entitlements';
import { getUsage } from '@/lib/billing/usage';
import { getProvider } from '@/lib/billing';
import { logger } from '@/lib/logger';
import {
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

/**
 * Customer self-service.
 *
 * Reads local billing state only — no provider API call on a page render.
 * Provider APIs are for commands and reconciliation; making the dashboard
 * depend on a live PayPal call would put their availability in front of ours.
 */
export async function GET() {
  try {
    const session = await requireUser();
    rateLimit(`subscription:${session.userId}`);

    const [entitlements, subscription, usage] = await Promise.all([
      getEntitlements(session.userId),
      getActiveSubscription(session.userId),
      getUsage(session.userId),
    ]);

    return NextResponse.json({
      entitlements: {
        active: entitlements.active,
        planCode: entitlements.planCode,
        planName: entitlements.planName,
        status: entitlements.status,
        reason: entitlements.reason,
        limits: entitlements.limits,
        currentPeriodEnd: entitlements.currentPeriodEnd,
        cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            interval: subscription.interval,
            amount: subscription.amount,
            currency: subscription.currency,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            provider: subscription.provider,
            // A reference for support conversations, not a credential.
            providerReference: subscription.providerSubscriptionId,
          }
        : null,
      usage: {
        used: usage.used,
        limit: usage.limit,
        remaining: usage.remaining,
        percentUsed: usage.percentUsed,
        threshold: usage.threshold,
        periodEnd: usage.period.end,
      },
    });
  } catch (error) {
    return handleRouteError(error, 'GET /api/billing/subscription');
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('resume') }),
]);

export async function PATCH(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`subscription-write:${session.userId}`, 20);

    const body = await parseBody(req, actionSchema);

    // Scoped read: another account's subscription id is not reachable here at
    // all, because the id is never taken from the request.
    const subscription = await getActiveSubscription(session.userId);

    if (!subscription) {
      return NextResponse.json(
        { error: 'No subscription found.' },
        { status: 404 },
      );
    }

    if (body.action === 'cancel') {
      if (subscription.providerSubscriptionId) {
        try {
          await getProvider().cancelSubscription(
            subscription.providerSubscriptionId,
            'Customer requested cancellation',
          );
        } catch (error) {
          logger.error('Provider cancellation failed', {
            subscriptionId: subscription.id,
            error: error instanceof Error ? error.message : String(error),
          });

          return NextResponse.json(
            { error: 'Could not cancel with the payment provider. Please retry.' },
            { status: 502 },
          );
        }
      }

      // Cancel at period end: the customer paid for this period and keeps it.
      const updated = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelAtPeriodEnd: true,
          cancelledAt: new Date(),
          status:
            subscription.status === SubscriptionStatus.TRIALING
              ? SubscriptionStatus.CANCELLED
              : subscription.status,
        },
      });

      logger.info('Subscription cancellation requested', {
        subscriptionId: updated.id,
      });

      return NextResponse.json({ ok: true, cancelAtPeriodEnd: true });
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false, cancelledAt: null },
    });

    return NextResponse.json({ ok: true, cancelAtPeriodEnd: updated.cancelAtPeriodEnd });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/billing/subscription');
  }
}
