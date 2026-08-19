import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { PLAN_CATALOG } from './catalog';
import { syncOffers } from './offers';
import { PayPalProvider } from './providers/paypal';
import type { BillingProvider } from './provider';

/**
 * Billing entry point.
 *
 * `getProvider` is the only place a concrete provider is named. Adding a
 * second one is a case here plus a file under `providers/`, and no change
 * anywhere in the domain.
 */
let cachedProvider: BillingProvider | null = null;

export function getProvider(): BillingProvider {
  if (!cachedProvider) cachedProvider = new PayPalProvider();
  return cachedProvider;
}

/** Test seam; not used in application code. */
export function __setProvider(provider: BillingProvider | null): void {
  cachedProvider = provider;
}

/**
 * Projects the code catalog into the database.
 *
 * The catalog stays the source of truth; these rows exist so subscriptions can
 * reference a stable plan id and so provider price ids have somewhere to live.
 * Idempotent — safe on every deploy.
 */
export async function syncCatalog(): Promise<{ plans: number; prices: number }> {
  let plans = 0;
  let prices = 0;

  for (const catalogPlan of PLAN_CATALOG) {
    const plan = await prisma.plan.upsert({
      where: { code: catalogPlan.code },
      create: {
        code: catalogPlan.code,
        name: catalogPlan.name,
        description: catalogPlan.description,
        sortOrder: catalogPlan.sortOrder,
        limits: catalogPlan.limits as unknown as Prisma.InputJsonValue,
        active: true,
      },
      update: {
        name: catalogPlan.name,
        description: catalogPlan.description,
        sortOrder: catalogPlan.sortOrder,
        limits: catalogPlan.limits as unknown as Prisma.InputJsonValue,
        active: true,
      },
    });

    plans += 1;

    for (const catalogPrice of catalogPlan.prices) {
      await prisma.price.upsert({
        where: {
          planId_interval_currency: {
            planId: plan.id,
            interval: catalogPrice.interval,
            currency: catalogPrice.currency,
          },
        },
        create: {
          planId: plan.id,
          interval: catalogPrice.interval,
          currency: catalogPrice.currency,
          amount: catalogPrice.amount,
          active: true,
        },
        // providerPriceId is deliberately untouched: it is provider state, not
        // catalog state, and a redeploy must not clear it.
        update: { amount: catalogPrice.amount, active: true },
      });

      prices += 1;
    }
  }

  await syncOffers();

  return { plans, prices };
}

export * from './catalog';
export * from './entitlements';
export * from './usage';
export * from './subscription';
export * from './offers';
export * from './checkout';
export type { BillingProvider, ProviderCapabilities } from './provider';
export { ProviderCapabilityError } from './provider';
