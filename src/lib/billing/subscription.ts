import { SubscriptionStatus, type Subscription } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Subscription state machine.
 *
 * Centralised so no route decides for itself what a status means. Webhooks
 * arrive duplicated, delayed and out of order, so transitions are validated
 * and an illegal one is ignored rather than applied — a late
 * `subscription.activated` must not resurrect a subscription the customer has
 * since cancelled.
 */
const TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIALING: ['ACTIVE', 'CANCELLED', 'EXPIRED', 'SUSPENDED'],
  ACTIVE: ['PAST_DUE', 'CANCELLED', 'SUSPENDED', 'EXPIRED', 'ACTIVE'],
  PAST_DUE: ['ACTIVE', 'CANCELLED', 'SUSPENDED', 'EXPIRED'],
  // Cancelled means "will not renew"; it may still be reactivated by the
  // provider before the period ends.
  CANCELLED: ['ACTIVE', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  // Terminal.
  EXPIRED: [],
};

export function canTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionResult {
  applied: boolean;
  subscription: Subscription;
  reason?: string;
}

/**
 * Applies a status change if the transition is legal.
 *
 * Returns `applied: false` rather than throwing, because the usual caller is a
 * webhook handler that must still return 2xx for an out-of-order delivery it
 * has correctly decided to ignore.
 */
export async function transitionSubscription(
  subscriptionId: string,
  to: SubscriptionStatus,
  patch: Partial<{
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    cancelledAt: Date | null;
    providerSubscriptionId: string;
  }> = {},
): Promise<TransitionResult> {
  const current = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!current) throw new Error(`Subscription ${subscriptionId} not found.`);

  if (current.status === to) {
    // Duplicate delivery of an event already applied. Period data may still be
    // worth refreshing, but the status write is a no-op.
    const updated = Object.keys(patch).length
      ? await prisma.subscription.update({ where: { id: subscriptionId }, data: patch })
      : current;

    return { applied: false, subscription: updated, reason: 'already in state' };
  }

  if (!canTransition(current.status, to)) {
    logger.warn('Ignoring illegal subscription transition', {
      subscriptionId,
      from: current.status,
      to,
    });

    return {
      applied: false,
      subscription: current,
      reason: `illegal transition ${current.status} -> ${to}`,
    };
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: to, ...patch },
  });

  logger.info('Subscription status changed', {
    subscriptionId,
    from: current.status,
    to,
  });

  return { applied: true, subscription: updated };
}

/**
 * Expires subscriptions whose paid period has ended.
 *
 * Called from the automation worker. Without it a CANCELLED subscription would
 * keep granting access forever on the strength of a `currentPeriodEnd` that
 * nothing ever re-reads.
 */
export async function expireLapsedSubscriptions(now = new Date()): Promise<number> {
  const lapsed = await prisma.subscription.findMany({
    where: {
      status: { in: [SubscriptionStatus.CANCELLED, SubscriptionStatus.PAST_DUE] },
      currentPeriodEnd: { lt: now },
    },
    select: { id: true },
    take: 200,
  });

  let expired = 0;

  for (const row of lapsed) {
    const result = await transitionSubscription(row.id, SubscriptionStatus.EXPIRED);
    if (result.applied) expired += 1;
  }

  if (expired > 0) logger.info('Expired lapsed subscriptions', { expired });

  return expired;
}
