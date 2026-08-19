import type { Metadata } from 'next';
import { PLAN_CATALOG, annualSavingPercent, FOUNDING_OFFER } from '@/lib/billing/catalog';
import { offerAvailability } from '@/lib/billing/offers';
import { getSession } from '@/lib/auth/session';
import { PricingTable } from './pricing-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الأسعار',
  description:
    'اختر خطة تسامي المناسبة لنشاطك — من اكتشاف الفرص إلى مشاريع مؤهلة، وكل إجراء خارجي باعتمادك.',
  alternates: { canonical: '/pricing' },
};

/**
 * Public pricing.
 *
 * The founding-partner promotion is shown only when the *server* says slots
 * remain, and never with a remaining count. A fabricated "3 left" is exactly
 * the fake urgency this page is meant to avoid, and a real count is internal
 * commercial information.
 */
export default async function PricingPage() {
  const [session, founding] = await Promise.all([
    getSession(),
    offerAvailability(FOUNDING_OFFER.code),
  ]);

  return (
    <PricingTable
      signedIn={session !== null}
      plans={PLAN_CATALOG.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        highlighted: plan.highlighted,
        features: plan.features,
        annualSaving: annualSavingPercent(plan),
        monthly: plan.prices.find((p) => p.interval === 'MONTH')!.amount,
        yearly: plan.prices.find((p) => p.interval === 'YEAR')!.amount,
      }))}
      offer={
        founding?.available
          ? { code: FOUNDING_OFFER.code, name: founding.name, description: founding.description }
          : null
      }
    />
  );
}
