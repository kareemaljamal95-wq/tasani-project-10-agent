import { Prisma, SubscriptionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getProvider } from './index';
import { hashPayload } from './providers/paypal';
import { transitionSubscription, activateFromCheckout } from './subscription';

/**
 * Provider webhook processing.
 *
 * The provider — not the browser — is the source of truth for whether a
 * customer has paid. Nothing in the return-from-PayPal flow activates access;
 * only a verified event reaching this file does.
 *
 * Delivery is assumed to be hostile in the ordinary ways: duplicated, retried,
 * delayed and out of order. Idempotency comes from a unique constraint on
 * (provider, providerEventId), and ordering safety from the subscription state
 * machine, which refuses illegal transitions instead of applying whatever
 * arrived last.
 */

export type WebhookOutcome =
  | { status: 'rejected'; reason: string }
  | { status: 'duplicate'; eventId: string }
  | { status: 'ignored'; eventId: string; reason: string }
  | { status: 'processed'; eventId: string; eventType: string };

/** Provider event types mapped to the state they imply. */
const EVENT_STATUS: Record<string, SubscriptionStatus> = {
  'BILLING.SUBSCRIPTION.ACTIVATED': SubscriptionStatus.ACTIVE,
  'BILLING.SUBSCRIPTION.RE-ACTIVATED': SubscriptionStatus.ACTIVE,
  'BILLING.SUBSCRIPTION.UPDATED': SubscriptionStatus.ACTIVE,
  'PAYMENT.SALE.COMPLETED': SubscriptionStatus.ACTIVE,
  'PAYMENT.CAPTURE.COMPLETED': SubscriptionStatus.ACTIVE,
  'BILLING.SUBSCRIPTION.CANCELLED': SubscriptionStatus.CANCELLED,
  'BILLING.SUBSCRIPTION.SUSPENDED': SubscriptionStatus.SUSPENDED,
  'BILLING.SUBSCRIPTION.EXPIRED': SubscriptionStatus.EXPIRED,
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': SubscriptionStatus.PAST_DUE,
  'PAYMENT.SALE.DENIED': SubscriptionStatus.PAST_DUE,
  'PAYMENT.CAPTURE.DENIED': SubscriptionStatus.PAST_DUE,
  'PAYMENT.SALE.REFUNDED': SubscriptionStatus.CANCELLED,
  'PAYMENT.CAPTURE.REFUNDED': SubscriptionStatus.CANCELLED,
  'PAYMENT.CAPTURE.REVERSED': SubscriptionStatus.SUSPENDED,
};

/**
 * The buyer approved an order. Not a state change — an instruction to collect.
 *
 * Kept out of EVENT_STATUS on purpose: approval is not payment, and mapping it
 * to ACTIVE would grant access to anyone who reached the PayPal page and
 * pressed a button. Capturing here is what produces the
 * PAYMENT.CAPTURE.COMPLETED that legitimately activates the subscription, so
 * the money still leads the access.
 */
const CAPTURE_ON = 'CHECKOUT.ORDER.APPROVED';

export async function processWebhook(
  rawBody: string,
  headers: Record<string, string>,
): Promise<WebhookOutcome> {
  const provider = getProvider();

  const verified = await provider.verifyWebhook(rawBody, headers);

  if (!verified.verified || !verified.eventId) {
    logger.warn('Billing webhook rejected', { provider: provider.name });
    return { status: 'rejected', reason: 'Signature verification failed.' };
  }

  const { eventId, eventType } = verified;

  // Idempotency: claim the event id first. A duplicate delivery loses the race
  // on the unique constraint and does no work.
  try {
    await prisma.billingEvent.create({
      data: {
        provider: provider.name,
        providerEventId: eventId,
        eventType: eventType ?? 'unknown',
        status: 'received',
        payloadHash: hashPayload(rawBody),
        metadata: verified.metadata as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      logger.info('Billing webhook duplicate ignored', { eventId });
      return { status: 'duplicate', eventId };
    }
    throw error;
  }

  // Ordered before the status mapping because this event carries no status.
  // It runs after the idempotency claim above, so a redelivered approval
  // cannot reach the capture call a second time — PayPal's own
  // PayPal-Request-Id deduplication is the second line, not the first.
  if (eventType === CAPTURE_ON) {
    const orderId = verified.metadata.resourceId;

    if (typeof orderId !== 'string' || !provider.captureOrder) {
      await markEvent(eventId, 'ignored', 'no order to capture');
      return { status: 'ignored', eventId, reason: 'No order to capture.' };
    }

    try {
      await provider.captureOrder(orderId);
    } catch (error) {
      // Left unprocessed and rethrown so the route answers 500 and the
      // provider retries. Failing quietly here would strand a buyer who has
      // paid nothing but believes they have.
      await markEvent(
        eventId,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    await markEvent(eventId, 'processed', null);
    return { status: 'processed', eventId, eventType };
  }

  const targetStatus = eventType ? EVENT_STATUS[eventType] : undefined;

  if (!targetStatus) {
    await markEvent(eventId, 'ignored', 'unhandled event type');
    return { status: 'ignored', eventId, reason: 'Unhandled event type.' };
  }

  let subscription = await findSubscription(
    provider.name,
    verified.providerSubscriptionId,
    verified.metadata,
  );

  // A first-time buyer has no subscription to transition — the row does not
  // exist until something creates it, and until now nothing did. An activating
  // event is exactly the moment it should. Restricted to activating events on
  // purpose: provisioning from a refund would manufacture a subscription out
  // of its own ending.
  if (!subscription && targetStatus === SubscriptionStatus.ACTIVE) {
    const userId = verified.metadata.customId;
    const orderId = verified.metadata.orderId;

    if (typeof userId === 'string' && userId.length > 0) {
      try {
        subscription = await activateFromCheckout(
          userId,
          provider.name,
          typeof orderId === 'string' ? orderId : null,
        );
      } catch (error) {
        // The unique constraint on (provider, providerSubscriptionId) rejects a
        // concurrent second activation for the same order. That is the guard
        // working, not a failure: re-read rather than create.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          subscription = await findSubscription(
            provider.name,
            verified.providerSubscriptionId,
            verified.metadata,
          );
        } else {
          throw error;
        }
      }
    }
  }

  if (!subscription) {
    // A verified event for something this deployment does not know about.
    // Recorded, not fatal — a webhook for another environment sharing the
    // merchant account looks exactly like this.
    await markEvent(eventId, 'ignored', 'no matching subscription');
    return { status: 'ignored', eventId, reason: 'No matching subscription.' };
  }

  const result = await transitionSubscription(subscription.id, targetStatus, {
    ...(targetStatus === SubscriptionStatus.CANCELLED
      ? { cancelledAt: new Date() }
      : {}),
    ...(verified.providerSubscriptionId
      ? { providerSubscriptionId: verified.providerSubscriptionId }
      : {}),
  });

  await prisma.billingEvent.update({
    where: { provider_providerEventId: { provider: provider.name, providerEventId: eventId } },
    data: {
      status: result.applied ? 'processed' : 'ignored',
      processedAt: new Date(),
      userId: subscription.userId,
      subscriptionId: subscription.id,
      error: result.applied ? null : (result.reason ?? null),
    },
  });

  logger.info('Billing webhook processed', {
    eventId,
    eventType,
    applied: result.applied,
    subscriptionId: subscription.id,
  });

  return { status: 'processed', eventId, eventType: eventType ?? 'unknown' };
}

async function markEvent(
  eventId: string,
  status: string,
  // Null for an event that succeeded: the error column should be empty, not
  // carry a sentence explaining that nothing went wrong.
  reason: string | null,
): Promise<void> {
  const provider = getProvider();

  await prisma.billingEvent.update({
    where: {
      provider_providerEventId: { provider: provider.name, providerEventId: eventId },
    },
    data: { status, processedAt: new Date(), error: reason },
  });
}

/**
 * Locates the subscription an event refers to.
 *
 * Tries the provider subscription id first, then `custom_id`, which is where
 * checkout put the account id. Both come from the *verified* payload, never
 * from a request the browser could shape.
 */
async function findSubscription(
  providerName: string,
  providerSubscriptionId: string | null,
  metadata: Record<string, unknown>,
) {
  if (providerSubscriptionId) {
    const bySubscription = await prisma.subscription.findFirst({
      where: { provider: providerName, providerSubscriptionId },
    });
    if (bySubscription) return bySubscription;
  }

  const customId = metadata.customId;

  if (typeof customId === 'string' && customId.length > 0) {
    return prisma.subscription.findFirst({
      where: { userId: customId, provider: providerName },
      orderBy: { createdAt: 'desc' },
    });
  }

  return null;
}
