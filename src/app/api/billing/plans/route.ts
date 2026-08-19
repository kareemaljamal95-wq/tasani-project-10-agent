import { NextResponse } from 'next/server';
import { PLAN_CATALOG, annualSavingPercent } from '@/lib/billing/catalog';
import { offerAvailability } from '@/lib/billing/offers';
import { FOUNDING_OFFER } from '@/lib/billing/catalog';
import { handleRouteError } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/**
 * Public pricing.
 *
 * Deliberately exposes only what a visitor may see. The founding offer is
 * reported as available or not — never the redemption count, which is internal
 * commercial information and would let anyone watch the launch fill up.
 */
export async function GET() {
  try {
    const founding = await offerAvailability(FOUNDING_OFFER.code);

    return NextResponse.json({
      plans: PLAN_CATALOG.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        highlighted: plan.highlighted,
        features: plan.features,
        annualSavingPercent: annualSavingPercent(plan),
        prices: plan.prices,
      })),
      offer: founding?.available
        ? { code: FOUNDING_OFFER.code, name: founding.name, description: founding.description }
        : null,
    });
  } catch (error) {
    return handleRouteError(error, 'GET /api/billing/plans');
  }
}
