import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { SubscriptionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createTestUser, resetDatabase, setProviderKey } from './helpers';
import {
  syncCatalog,
  __setProvider,
} from '@/lib/billing';
import {
  findCatalogPlan,
  findCatalogPrice,
  annualSavingPercent,
  PLAN_CATALOG,
  FOUNDING_OFFER,
} from '@/lib/billing/catalog';
import { startCheckout, CheckoutError } from '@/lib/billing/checkout';
import {
  evaluateOffer,
  redeemOffer,
  OfferUnavailableError,
  offerAvailability,
} from '@/lib/billing/offers';
import {
  getEntitlements,
  requireCapability,
  requireWithinLimit,
  EntitlementError,
  grantsAccess,
} from '@/lib/billing/entitlements';
import { consumeAiAction, getUsage, UsageLimitError } from '@/lib/billing/usage';
import {
  transitionSubscription,
  expireLapsedSubscriptions,
  canTransition,
} from '@/lib/billing/subscription';
import { processWebhook } from '@/lib/billing/webhook';
import type { BillingProvider, VerifiedWebhook } from '@/lib/billing/provider';

/**
 * Billing suite.
 *
 * The provider is replaced with a stub at the `BillingProvider` boundary —
 * the same seam a second real provider would occupy — so these tests exercise
 * the actual domain rather than a mock of it. Nothing here stubs the
 * application's own logic.
 */
let verifyResult: VerifiedWebhook = {
  verified: true,
  eventId: 'evt-1',
  eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
  providerSubscriptionId: 'I-SUB-1',
  metadata: {},
};

let createdOrders = 0;
let capturedOrders: string[] = [];
let captureFails = false;

const stubProvider: BillingProvider = {
  name: 'paypal',
  async capabilities() {
    return {
      restApi: true,
      subscriptions: true,
      webhooks: true,
      production: false,
      detail: ['stub'],
    };
  },
  async createCheckout(input) {
    createdOrders += 1;
    return {
      providerOrderId: `ORDER-${createdOrders}`,
      approvalUrl: `https://provider.test/approve/${createdOrders}?amount=${input.amount}`,
    };
  },
  async verifyWebhook() {
    return verifyResult;
  },
  async captureOrder(providerOrderId) {
    if (captureFails) throw new Error('capture declined');
    capturedOrders.push(providerOrderId);
  },
  async cancelSubscription() {},
};

beforeEach(async () => {
  await resetDatabase();
  await syncCatalog();
  setProviderKey();
  __setProvider(stubProvider);
  createdOrders = 0;
  capturedOrders = [];
  captureFails = false;
  verifyResult = {
    verified: true,
    eventId: 'evt-1',
    eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
    providerSubscriptionId: 'I-SUB-1',
    metadata: {},
  };
});

afterAll(async () => {
  __setProvider(null);
  await prisma.$disconnect();
});

let subscriptionSeq = 0;

/** Gives a user a subscription in a known state. */
async function giveSubscription(
  userId: string,
  planCode: string,
  status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
  overrides: Record<string, unknown> = {},
) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
  const price = await prisma.price.findFirstOrThrow({
    where: { planId: plan.id, interval: 'MONTH' },
  });

  return prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      priceId: price.id,
      provider: 'paypal',
      // Unique per fixture: cuid ids share a leading prefix, so slicing one
      // would collide across users and trip the (provider, providerSubscriptionId)
      // constraint that this suite relies on elsewhere.
      providerSubscriptionId: `I-SUB-${(subscriptionSeq += 1)}-${Date.now()}`,
      status,
      currency: price.currency,
      amount: price.amount,
      interval: 'MONTH',
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 25 * 86_400_000),
      ...overrides,
    },
  });
}

// 1-3 ------------------------------------------------------------------------
describe('pricing resolution', () => {
  it('resolves the monthly price from the catalog', () => {
    expect(findCatalogPrice('growth', 'MONTH')?.amount).toBe(14900);
    expect(findCatalogPrice('starter', 'MONTH')?.amount).toBe(4900);
    expect(findCatalogPrice('scale', 'MONTH')?.amount).toBe(39900);
  });

  it('resolves the annual price from the catalog', () => {
    expect(findCatalogPrice('growth', 'YEAR')?.amount).toBe(149000);
    expect(findCatalogPrice('starter', 'YEAR')?.amount).toBe(49000);
    expect(findCatalogPrice('scale', 'YEAR')?.amount).toBe(399000);
  });

  it('prices annual around 17% below twelve monthly payments', () => {
    for (const plan of PLAN_CATALOG) {
      expect(annualSavingPercent(plan)).toBe(17);
    }
  });

  it('marks exactly one plan as the default', () => {
    expect(PLAN_CATALOG.filter((p) => p.highlighted).map((p) => p.code)).toEqual([
      'growth',
    ]);
  });
});

// 4-5 ------------------------------------------------------------------------
describe('founding offer', () => {
  it('applies the discounted price to an eligible account', async () => {
    const user = await createTestUser();
    const evaluation = await evaluateOffer(FOUNDING_OFFER.code, user.id, 'growth');

    expect(evaluation.eligible).toBe(true);
    expect(evaluation.amount).toBe(9900);
    expect(evaluation.durationMonths).toBe(3);
  });

  it('stops at the redemption cap and refuses the 21st account', async () => {
    await prisma.offer.update({
      where: { code: FOUNDING_OFFER.code },
      data: { maxRedemptions: 20 },
    });

    for (let i = 0; i < 20; i += 1) {
      const user = await createTestUser();
      await redeemOffer(FOUNDING_OFFER.code, user.id, 'growth');
    }

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { code: FOUNDING_OFFER.code },
    });
    expect(offer.redemptionCount).toBe(20);

    const twentyFirst = await createTestUser();

    await expect(
      redeemOffer(FOUNDING_OFFER.code, twentyFirst.id, 'growth'),
    ).rejects.toBeInstanceOf(OfferUnavailableError);

    // And it stops being advertised.
    expect((await offerAvailability(FOUNDING_OFFER.code))?.available).toBe(false);
  });

  it('refuses a second redemption by the same account', async () => {
    const user = await createTestUser();
    await redeemOffer(FOUNDING_OFFER.code, user.id, 'growth');

    await expect(
      redeemOffer(FOUNDING_OFFER.code, user.id, 'growth'),
    ).rejects.toBeInstanceOf(OfferUnavailableError);

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { code: FOUNDING_OFFER.code },
    });
    // The rolled-back transaction returned the slot.
    expect(offer.redemptionCount).toBe(1);
  });

  it('holds the cap under concurrent redemption', async () => {
    await prisma.offer.update({
      where: { code: FOUNDING_OFFER.code },
      data: { maxRedemptions: 3 },
    });

    const users = await Promise.all(
      Array.from({ length: 10 }, () => createTestUser()),
    );

    const results = await Promise.allSettled(
      users.map((u) => redeemOffer(FOUNDING_OFFER.code, u.id, 'growth')),
    );

    const granted = results.filter((r) => r.status === 'fulfilled').length;

    // The conditional UPDATE is what makes this exact rather than approximate.
    expect(granted).toBe(3);
    expect(
      (await prisma.offer.findUniqueOrThrow({ where: { code: FOUNDING_OFFER.code } }))
        .redemptionCount,
    ).toBe(3);
  });
});

// 6-8 ------------------------------------------------------------------------
describe('checkout authorization and price integrity', () => {
  it('resolves the amount server-side from the plan code', async () => {
    const user = await createTestUser();

    const result = await startCheckout({
      userId: user.id,
      planCode: 'growth',
      interval: 'MONTH',
      idempotencyKey: 'key-1',
    });

    expect(result.amount).toBe(14900);
    expect(result.currency).toBe('USD');

    const stored = await prisma.checkoutSession.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.amount).toBe(14900);
  });

  it('charges the annual amount for an annual interval', async () => {
    const user = await createTestUser();

    const result = await startCheckout({
      userId: user.id,
      planCode: 'scale',
      interval: 'YEAR',
      idempotencyKey: 'key-year',
    });

    expect(result.amount).toBe(399000);
  });

  it('applies the offer price when eligible, not the list price', async () => {
    const user = await createTestUser();

    const result = await startCheckout({
      userId: user.id,
      planCode: 'growth',
      interval: 'MONTH',
      offerCode: FOUNDING_OFFER.code,
      idempotencyKey: 'key-offer',
    });

    expect(result.amount).toBe(9900);
  });

  it('rejects an unknown plan code', async () => {
    const user = await createTestUser();

    await expect(
      startCheckout({
        userId: user.id,
        planCode: 'enterprise-free',
        interval: 'MONTH',
        idempotencyKey: 'key-bad',
      }),
    ).rejects.toBeInstanceOf(CheckoutError);
  });

  it('has no way for a caller to supply an amount or currency', async () => {
    const user = await createTestUser();

    // The input type carries no amount/currency field. Passing them anyway —
    // as a hostile client would — changes nothing about what is charged.
    const hostile = {
      userId: user.id,
      planCode: 'scale',
      interval: 'MONTH' as const,
      idempotencyKey: 'key-hostile',
      amount: 1,
      currency: 'XXX',
      priceId: 'someone-elses-price',
    };

    const result = await startCheckout(hostile);

    expect(result.amount).toBe(39900);
    expect(result.currency).toBe('USD');
  });
});

// 9 --------------------------------------------------------------------------
describe('checkout idempotency', () => {
  it('returns the original session for a repeated key', async () => {
    const user = await createTestUser();

    const first = await startCheckout({
      userId: user.id,
      planCode: 'growth',
      interval: 'MONTH',
      idempotencyKey: 'same-key',
    });

    const second = await startCheckout({
      userId: user.id,
      planCode: 'growth',
      interval: 'MONTH',
      idempotencyKey: 'same-key',
    });

    expect(second.reused).toBe(true);
    expect(second.checkoutId).toBe(first.checkoutId);
    expect(createdOrders).toBe(1);
    expect(await prisma.checkoutSession.count({ where: { userId: user.id } })).toBe(1);
  });
});

// 10-14 ----------------------------------------------------------------------
describe('webhooks', () => {
  it('rejects an invalid signature and changes nothing', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(
      user.id,
      'growth',
      SubscriptionStatus.TRIALING,
    );

    verifyResult = {
      verified: false,
      eventId: null,
      eventType: null,
      providerSubscriptionId: null,
      metadata: {},
    };

    const outcome = await processWebhook('{}', {});

    expect(outcome.status).toBe('rejected');
    expect(await prisma.billingEvent.count()).toBe(0);

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(after.status).toBe(SubscriptionStatus.TRIALING);
  });

  it('activates a subscription on a verified event', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(
      user.id,
      'growth',
      SubscriptionStatus.TRIALING,
    );

    verifyResult.providerSubscriptionId = subscription.providerSubscriptionId;

    const outcome = await processWebhook('{"id":"evt-1"}', {});
    expect(outcome.status).toBe('processed');

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(after.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('ignores a duplicate delivery of the same event id', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(
      user.id,
      'growth',
      SubscriptionStatus.TRIALING,
    );
    verifyResult.providerSubscriptionId = subscription.providerSubscriptionId;

    await processWebhook('{"id":"evt-1"}', {});
    const second = await processWebhook('{"id":"evt-1"}', {});

    expect(second.status).toBe('duplicate');
    expect(await prisma.billingEvent.count()).toBe(1);
  });

  it('refuses an out-of-order event that would resurrect an expired subscription', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(
      user.id,
      'growth',
      SubscriptionStatus.EXPIRED,
    );

    verifyResult = {
      verified: true,
      eventId: 'evt-late',
      eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
      providerSubscriptionId: subscription.providerSubscriptionId,
      metadata: {},
    };

    await processWebhook('{"id":"evt-late"}', {});

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    // EXPIRED is terminal; a late activation must not undo it.
    expect(after.status).toBe(SubscriptionStatus.EXPIRED);
  });

  it('records a payment failure as PAST_DUE and a cancellation as CANCELLED', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(user.id, 'growth');

    verifyResult = {
      verified: true,
      eventId: 'evt-failed',
      eventType: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      providerSubscriptionId: subscription.providerSubscriptionId,
      metadata: {},
    };
    await processWebhook('{"id":"evt-failed"}', {});

    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }))
        .status,
    ).toBe(SubscriptionStatus.PAST_DUE);

    verifyResult = {
      verified: true,
      eventId: 'evt-cancel',
      eventType: 'BILLING.SUBSCRIPTION.CANCELLED',
      providerSubscriptionId: subscription.providerSubscriptionId,
      metadata: {},
    };
    await processWebhook('{"id":"evt-cancel"}', {});

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(after.status).toBe(SubscriptionStatus.CANCELLED);
    expect(after.cancelledAt).not.toBeNull();
  });

  it('stores no raw payload, only a hash and redacted metadata', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(user.id, 'growth', SubscriptionStatus.TRIALING);
    verifyResult.providerSubscriptionId = subscription.providerSubscriptionId;

    const body = '{"id":"evt-1","payer":{"email_address":"buyer@example.test"}}';
    await processWebhook(body, {});

    const event = await prisma.billingEvent.findFirstOrThrow();
    expect(event.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event.metadata)).not.toContain('buyer@example.test');
  });

  it('captures an approved order instead of activating on approval', async () => {
    // Approval is a button press, not a payment. It must collect the money and
    // leave activation to the capture event that follows.
    const user = await createTestUser();
    const subscription = await giveSubscription(
      user.id,
      'growth',
      SubscriptionStatus.TRIALING,
    );

    verifyResult = {
      verified: true,
      eventId: 'evt-approved',
      eventType: 'CHECKOUT.ORDER.APPROVED',
      providerSubscriptionId: null,
      metadata: { resourceId: 'ORDER-42' },
    };

    const outcome = await processWebhook('{"id":"evt-approved"}', {});

    expect(outcome.status).toBe('processed');
    expect(capturedOrders).toEqual(['ORDER-42']);

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(after.status).toBe(SubscriptionStatus.TRIALING);
  });

  it('captures once when the same approval is redelivered', async () => {
    await createTestUser();

    verifyResult = {
      verified: true,
      eventId: 'evt-approved',
      eventType: 'CHECKOUT.ORDER.APPROVED',
      providerSubscriptionId: null,
      metadata: { resourceId: 'ORDER-42' },
    };

    await processWebhook('{"id":"evt-approved"}', {});
    const second = await processWebhook('{"id":"evt-approved"}', {});

    expect(second.status).toBe('duplicate');
    expect(capturedOrders).toEqual(['ORDER-42']);
  });

  it('provisions a subscription for a first-time buyer on capture', async () => {
    // Nothing in the codebase created a Subscription row, so a first-time
    // buyer's capture event found nothing to transition and the customer paid
    // for nothing. The paid event itself has to bring the subscription into
    // existence.
    const user = await createTestUser();

    const checkout = await startCheckout({
      userId: user.id,
      planCode: 'growth',
      interval: 'MONTH',
      idempotencyKey: 'provision-1',
    });

    const order = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: checkout.checkoutId },
    });

    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(0);

    verifyResult = {
      verified: true,
      eventId: 'evt-capture',
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      providerSubscriptionId: null,
      metadata: { customId: user.id, orderId: order.providerOrderId },
    };

    const outcome = await processWebhook('{"id":"evt-capture"}', {});
    expect(outcome.status).toBe('processed');

    const created = await prisma.subscription.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(created.status).toBe(SubscriptionStatus.ACTIVE);
    // Amount is the server-resolved one from the checkout, never a client value.
    expect(created.amount).toBe(order.amount);
    expect(created.currency).toBe(order.currency);
    expect(created.currentPeriodEnd).not.toBeNull();

    const closed = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: checkout.checkoutId },
    });
    expect(closed.status).toBe('COMPLETED');
  });

  it('does not provision a subscription from a refund', async () => {
    // Provisioning on a terminating event would manufacture a subscription out
    // of its own ending.
    const user = await createTestUser();

    await startCheckout({
      userId: user.id,
      planCode: 'growth',
      interval: 'MONTH',
      idempotencyKey: 'provision-2',
    });

    verifyResult = {
      verified: true,
      eventId: 'evt-refund',
      eventType: 'PAYMENT.CAPTURE.REFUNDED',
      providerSubscriptionId: null,
      metadata: { customId: user.id },
    };

    const outcome = await processWebhook('{"id":"evt-refund"}', {});

    expect(outcome.status).toBe('ignored');
    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(0);
  });

  it('surfaces a failed capture so the provider retries', async () => {
    await createTestUser();
    captureFails = true;

    verifyResult = {
      verified: true,
      eventId: 'evt-approved',
      eventType: 'CHECKOUT.ORDER.APPROVED',
      providerSubscriptionId: null,
      metadata: { resourceId: 'ORDER-42' },
    };

    // Rethrown rather than swallowed: the route answers 500, PayPal retries,
    // and a buyer is never left believing they paid when nothing was taken.
    await expect(processWebhook('{"id":"evt-approved"}', {})).rejects.toThrow();

    const event = await prisma.billingEvent.findFirstOrThrow();
    expect(event.status).toBe('failed');
  });
});

// 15-16 ----------------------------------------------------------------------
describe('subscription state machine', () => {
  it('permits only legal transitions', () => {
    expect(canTransition(SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE)).toBe(true);
    expect(canTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE)).toBe(true);
    expect(canTransition(SubscriptionStatus.EXPIRED, SubscriptionStatus.ACTIVE)).toBe(false);
  });

  it('expires a cancelled subscription once its paid period ends', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(
      user.id,
      'growth',
      SubscriptionStatus.CANCELLED,
      { currentPeriodEnd: new Date(Date.now() - 1000) },
    );

    // Before expiry runs, access has already lapsed by date.
    expect(grantsAccess(await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }))).toBe(false);

    const expired = await expireLapsedSubscriptions();
    expect(expired).toBe(1);

    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }))
        .status,
    ).toBe(SubscriptionStatus.EXPIRED);
  });

  it('keeps access for a cancelled subscription until the period ends', async () => {
    const user = await createTestUser();
    await giveSubscription(user.id, 'growth', SubscriptionStatus.CANCELLED, {
      currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000),
    });

    const entitlements = await getEntitlements(user.id);
    expect(entitlements.active).toBe(true);
    expect(entitlements.limits['agents.max']).toBe(5);
  });
});

// 17, 20 ---------------------------------------------------------------------
describe('entitlement enforcement', () => {
  it('denies every paid capability to an unpaid account', async () => {
    const user = await createTestUser();

    const entitlements = await getEntitlements(user.id);
    expect(entitlements.active).toBe(false);
    expect(entitlements.limits['aiActions.monthly']).toBe(0);
    expect(entitlements.limits['agents.max']).toBe(0);

    await expect(
      requireCapability(user.id, 'leads.enabled'),
    ).rejects.toBeInstanceOf(EntitlementError);

    await expect(
      requireWithinLimit(user.id, 'agents.max', 0),
    ).rejects.toBeInstanceOf(EntitlementError);
  });

  it('applies the limits of the plan actually held', async () => {
    const starter = await createTestUser();
    const scale = await createTestUser();

    await giveSubscription(starter.id, 'starter');
    await giveSubscription(scale.id, 'scale');

    expect((await getEntitlements(starter.id)).limits['agents.max']).toBe(1);
    expect((await getEntitlements(scale.id)).limits['agents.max']).toBe(15);

    // Starter is at its ceiling with one agent; Scale is not.
    await expect(
      requireWithinLimit(starter.id, 'agents.max', 1),
    ).rejects.toBeInstanceOf(EntitlementError);

    await expect(
      requireWithinLimit(scale.id, 'agents.max', 1),
    ).resolves.toBeDefined();
  });

  it('denies a feature the plan excludes', async () => {
    const user = await createTestUser();
    await giveSubscription(user.id, 'starter');

    // Starter has advancedAutomation disabled.
    await expect(
      requireCapability(user.id, 'advancedAutomation.enabled'),
    ).rejects.toBeInstanceOf(EntitlementError);

    await expect(
      requireCapability(user.id, 'leads.enabled'),
    ).resolves.toBeDefined();
  });

  it('denies paid capability once a subscription is suspended', async () => {
    const user = await createTestUser();
    await giveSubscription(user.id, 'growth', SubscriptionStatus.SUSPENDED);

    const entitlements = await getEntitlements(user.id);
    expect(entitlements.active).toBe(false);
    expect(entitlements.limits['aiActions.monthly']).toBe(0);
  });
});

// 18 -------------------------------------------------------------------------
describe('usage metering', () => {
  it('counts an AI action and reports remaining quota', async () => {
    const user = await createTestUser();
    await giveSubscription(user.id, 'starter');

    await consumeAiAction(user.id);
    const usage = await getUsage(user.id);

    expect(usage.used).toBe(1);
    expect(usage.limit).toBe(500);
    expect(usage.remaining).toBe(499);
  });

  it('refuses once the limit is reached and does not charge the refused call', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(user.id, 'starter');

    // Park the counter one below the limit.
    await prisma.usageCounter.create({
      data: {
        userId: user.id,
        periodKey: subscription.currentPeriodStart!.toISOString().slice(0, 10),
        periodStart: subscription.currentPeriodStart!,
        periodEnd: subscription.currentPeriodEnd!,
        metric: 'ai_actions',
        count: 499,
      },
    });

    await consumeAiAction(user.id); // 500th, allowed

    await expect(consumeAiAction(user.id)).rejects.toBeInstanceOf(UsageLimitError);

    // The refused call was rolled back, so the count sits exactly at the limit.
    expect((await getUsage(user.id)).used).toBe(500);
  });

  it('does not let concurrent requests exceed the limit', async () => {
    const user = await createTestUser();
    const subscription = await giveSubscription(user.id, 'starter');

    await prisma.usageCounter.create({
      data: {
        userId: user.id,
        periodKey: subscription.currentPeriodStart!.toISOString().slice(0, 10),
        periodStart: subscription.currentPeriodStart!,
        periodEnd: subscription.currentPeriodEnd!,
        metric: 'ai_actions',
        count: 497,
      },
    });

    // Ten simultaneous requests against three remaining actions.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => consumeAiAction(user.id)),
    );

    const allowed = results.filter((r) => r.status === 'fulfilled').length;

    expect(allowed).toBe(3);
    expect((await getUsage(user.id)).used).toBe(500);
  });

  it('refuses metered work for an unpaid account', async () => {
    const user = await createTestUser();

    await expect(consumeAiAction(user.id)).rejects.toBeInstanceOf(EntitlementError);
  });
});

// 19 -------------------------------------------------------------------------
describe('cross-account billing access', () => {
  it('scopes entitlements and usage to the owning account', async () => {
    const paid = await createTestUser();
    const other = await createTestUser();

    await giveSubscription(paid.id, 'scale');
    await consumeAiAction(paid.id);

    expect((await getEntitlements(paid.id)).active).toBe(true);
    // The other account gets nothing from its neighbour's subscription.
    expect((await getEntitlements(other.id)).active).toBe(false);
    expect((await getUsage(other.id)).used).toBe(0);
  });

  it('does not let one account\'s checkout appear under another', async () => {
    const buyer = await createTestUser();
    const other = await createTestUser();

    await startCheckout({
      userId: buyer.id,
      planCode: 'growth',
      interval: 'MONTH',
      idempotencyKey: 'buyer-key',
    });

    const foreign = await prisma.checkoutSession.findFirst({
      where: { userId: other.id },
    });

    expect(foreign).toBeNull();
  });

  it('keeps offer redemptions per account', async () => {
    const first = await createTestUser();
    const second = await createTestUser();

    await redeemOffer(FOUNDING_OFFER.code, first.id, 'growth');

    // A different account is still eligible.
    expect((await evaluateOffer(FOUNDING_OFFER.code, second.id, 'growth')).eligible).toBe(
      true,
    );
    expect((await evaluateOffer(FOUNDING_OFFER.code, first.id, 'growth')).eligible).toBe(
      false,
    );
  });
});
