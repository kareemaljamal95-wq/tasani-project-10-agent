import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { FOUNDING_OFFER } from './catalog';

/**
 * Promotional offers.
 *
 * The founding-partner promotion is a row, not a branch. Eligibility, the cap
 * and the redemption count all live in data, so the 21st customer is refused
 * by the same code path that admitted the first twenty.
 */

export interface OfferEvaluation {
  eligible: boolean;
  /** Discounted amount in minor units, when eligible. */
  amount?: number;
  currency?: string;
  durationMonths?: number;
  reason?: string;
}

/** Creates or refreshes the configured offers. Safe to run repeatedly. */
export async function syncOffers(): Promise<void> {
  await prisma.offer.upsert({
    where: { code: FOUNDING_OFFER.code },
    create: {
      code: FOUNDING_OFFER.code,
      name: FOUNDING_OFFER.name,
      description: FOUNDING_OFFER.description,
      currency: FOUNDING_OFFER.currency,
      amount: FOUNDING_OFFER.amount,
      durationMonths: FOUNDING_OFFER.durationMonths,
      maxRedemptions: FOUNDING_OFFER.maxRedemptions,
      eligiblePlanCodes: [...FOUNDING_OFFER.eligiblePlanCodes],
      active: true,
    },
    // redemptionCount is deliberately not in the update: a redeploy must never
    // reset how many customers have already taken the offer.
    update: {
      name: FOUNDING_OFFER.name,
      description: FOUNDING_OFFER.description,
      amount: FOUNDING_OFFER.amount,
      durationMonths: FOUNDING_OFFER.durationMonths,
      maxRedemptions: FOUNDING_OFFER.maxRedemptions,
      eligiblePlanCodes: [...FOUNDING_OFFER.eligiblePlanCodes],
    },
  });
}

/** Read-only eligibility check, for pricing display and pre-checkout. */
export async function evaluateOffer(
  offerCode: string,
  userId: string,
  planCode: string,
  now = new Date(),
): Promise<OfferEvaluation> {
  const offer = await prisma.offer.findUnique({ where: { code: offerCode } });

  if (!offer || !offer.active) {
    return { eligible: false, reason: 'Offer not available.' };
  }

  if (offer.startsAt && offer.startsAt > now) {
    return { eligible: false, reason: 'Offer has not started.' };
  }

  if (offer.endsAt && offer.endsAt <= now) {
    return { eligible: false, reason: 'Offer has ended.' };
  }

  if (
    offer.eligiblePlanCodes.length > 0 &&
    !offer.eligiblePlanCodes.includes(planCode)
  ) {
    return { eligible: false, reason: 'Offer does not apply to this plan.' };
  }

  if (offer.redemptionCount >= offer.maxRedemptions) {
    return { eligible: false, reason: 'Offer is fully subscribed.' };
  }

  const existing = await prisma.offerRedemption.findUnique({
    where: { offerCode_userId: { offerCode, userId } },
  });

  if (existing) {
    return { eligible: false, reason: 'Offer already redeemed on this account.' };
  }

  return {
    eligible: true,
    amount: offer.amount,
    currency: offer.currency,
    durationMonths: offer.durationMonths,
  };
}

export class OfferUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'OfferUnavailableError';
  }
}

/**
 * Claims one redemption, atomically.
 *
 * The count is incremented by a conditional UPDATE guarded on
 * `redemptionCount < maxRedemptions`, so twenty concurrent checkouts on the
 * last slot produce exactly one winner — a read-then-write would let several
 * see nineteen and all proceed. The unique key on (offerCode, userId) is the
 * second guard, against one account redeeming twice.
 */
export async function redeemOffer(
  offerCode: string,
  userId: string,
  planCode: string,
): Promise<{ amount: number; currency: string; durationMonths: number }> {
  const evaluation = await evaluateOffer(offerCode, userId, planCode);

  if (!evaluation.eligible) {
    throw new OfferUnavailableError(evaluation.reason ?? 'Offer not available.');
  }

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.$executeRaw`
      UPDATE "Offer"
      SET "redemptionCount" = "redemptionCount" + 1, "updatedAt" = NOW()
      WHERE "code" = ${offerCode}
        AND "active" = true
        AND "redemptionCount" < "maxRedemptions"
    `;

    if (claimed === 0) {
      throw new OfferUnavailableError('Offer is fully subscribed.');
    }

    const offer = await tx.offer.findUniqueOrThrow({ where: { code: offerCode } });

    try {
      await tx.offerRedemption.create({
        data: {
          offerCode,
          userId,
          expiresAt: new Date(
            Date.now() + offer.durationMonths * 30 * 24 * 60 * 60 * 1000,
          ),
        },
      });
    } catch (error) {
      // The unique constraint fired: this account already had it. Rolling back
      // the transaction returns the slot.
      throw new OfferUnavailableError(
        'Offer already redeemed on this account.',
      );
    }

    logger.info('Offer redeemed', {
      offerCode,
      userId,
      remaining: offer.maxRedemptions - offer.redemptionCount,
    });

    return {
      amount: offer.amount,
      currency: offer.currency,
      durationMonths: offer.durationMonths,
    };
  });
}

/**
 * Public availability, for the pricing page.
 *
 * Exposes only whether the offer is still open — never the redemption count,
 * which is internal commercial information and would let anyone watch the
 * launch fill up.
 */
export async function offerAvailability(
  offerCode: string,
): Promise<{ available: boolean; name: string; description: string } | null> {
  const offer = await prisma.offer.findUnique({ where: { code: offerCode } });
  if (!offer) return null;

  const now = new Date();
  const open =
    offer.active &&
    offer.redemptionCount < offer.maxRedemptions &&
    (!offer.startsAt || offer.startsAt <= now) &&
    (!offer.endsAt || offer.endsAt > now);

  return { available: open, name: offer.name, description: offer.description };
}
