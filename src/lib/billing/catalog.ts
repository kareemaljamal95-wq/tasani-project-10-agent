/**
 * Commercial catalog — the single source of truth for what Tasami sells.
 *
 * Pricing lives here as data. Nothing in the application branches on a plan
 * code; features are gated through `entitlements.ts`, which reads the limits
 * below. Adding a plan or changing a limit is an edit to this file plus a
 * catalog sync, never a change to feature code.
 *
 * Amounts are integer minor units (cents). Annual prices are set explicitly
 * rather than derived, because the discount is a commercial decision and a
 * rounding rule should not silently change a published price.
 */

export type PlanCode = 'starter' | 'growth' | 'scale';

export interface PlanLimits {
  /** Maximum simultaneously enabled agents. */
  'agents.max': number;
  /** Maximum enabled automation triggers. */
  'automations.max': number;
  /** Seats on the account. Enforced when multi-seat ships; stored now so the
   *  entitlement surface does not change shape later. */
  'seats.max': number;
  /** Billable agent executions per billing period. */
  'aiActions.monthly': number;
  'leads.enabled': boolean;
  'approvals.enabled': boolean;
  'advancedAutomation.enabled': boolean;
  'prioritySupport.enabled': boolean;
}

export interface CatalogPrice {
  interval: 'MONTH' | 'YEAR';
  currency: string;
  /** Minor units: 4900 = $49.00 */
  amount: number;
}

export interface CatalogPlan {
  code: PlanCode;
  name: string;
  description: string;
  sortOrder: number;
  /** Emphasised in the pricing UI. Exactly one plan should carry this. */
  highlighted: boolean;
  limits: PlanLimits;
  prices: CatalogPrice[];
  /** Customer-facing feature lines for the pricing page. */
  features: string[];
}

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'أتمِت أول سير عمل في نشاطك.',
    sortOrder: 1,
    highlighted: false,
    limits: {
      'agents.max': 1,
      'automations.max': 1,
      'seats.max': 1,
      'aiActions.monthly': 500,
      'leads.enabled': true,
      'approvals.enabled': true,
      'advancedAutomation.enabled': false,
      'prioritySupport.enabled': false,
    },
    prices: [
      { interval: 'MONTH', currency: 'USD', amount: 4900 },
      { interval: 'YEAR', currency: 'USD', amount: 49000 },
    ],
    features: [
      'وكيل واحد نشط',
      'أتمتة واحدة',
      '500 إجراء ذكاء اصطناعي شهريًا',
      'العملاء المحتملون وبوابة الاعتماد',
      'مقعد واحد',
    ],
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'أدِر نشاطك بفريق من وكلاء الذكاء الاصطناعي.',
    sortOrder: 2,
    highlighted: true,
    limits: {
      'agents.max': 5,
      'automations.max': 10,
      'seats.max': 5,
      'aiActions.monthly': 3000,
      'leads.enabled': true,
      'approvals.enabled': true,
      'advancedAutomation.enabled': true,
      'prioritySupport.enabled': false,
    },
    prices: [
      { interval: 'MONTH', currency: 'USD', amount: 14900 },
      { interval: 'YEAR', currency: 'USD', amount: 149000 },
    ],
    features: [
      '5 وكلاء نشطين',
      '10 أتمتات',
      '3,000 إجراء ذكاء اصطناعي شهريًا',
      'أتمتة متقدمة',
      '5 مقاعد',
    ],
  },
  {
    code: 'scale',
    name: 'Scale',
    description: 'ابنِ طبقة تشغيل بالذكاء الاصطناعي لفريقك.',
    sortOrder: 3,
    highlighted: false,
    limits: {
      'agents.max': 15,
      'automations.max': 50,
      'seats.max': 15,
      'aiActions.monthly': 15000,
      'leads.enabled': true,
      'approvals.enabled': true,
      'advancedAutomation.enabled': true,
      'prioritySupport.enabled': true,
    },
    prices: [
      { interval: 'MONTH', currency: 'USD', amount: 39900 },
      { interval: 'YEAR', currency: 'USD', amount: 399000 },
    ],
    features: [
      '15 وكيلًا نشطًا',
      '50 أتمتة',
      '15,000 إجراء ذكاء اصطناعي شهريًا',
      'أتمتة متقدمة',
      'دعم ذو أولوية',
      '15 مقعدًا',
    ],
  },
];

/**
 * Entitlements for an account with no paid subscription.
 *
 * Not a free tier: every metered capability is zero. An unpaid account can
 * sign in and see the product, and can do no billable work.
 */
export const UNENTITLED_LIMITS: PlanLimits = {
  'agents.max': 0,
  'automations.max': 0,
  'seats.max': 1,
  'aiActions.monthly': 0,
  'leads.enabled': false,
  'approvals.enabled': false,
  'advancedAutomation.enabled': false,
  'prioritySupport.enabled': false,
};

export function findCatalogPlan(code: string): CatalogPlan | undefined {
  return PLAN_CATALOG.find((plan) => plan.code === code);
}

export function findCatalogPrice(
  code: string,
  interval: 'MONTH' | 'YEAR',
): CatalogPrice | undefined {
  return findCatalogPlan(code)?.prices.find((p) => p.interval === interval);
}

/** Percentage saved by paying annually, for the pricing page. */
export function annualSavingPercent(plan: CatalogPlan): number {
  const monthly = plan.prices.find((p) => p.interval === 'MONTH')?.amount;
  const yearly = plan.prices.find((p) => p.interval === 'YEAR')?.amount;
  if (!monthly || !yearly) return 0;
  return Math.round((1 - yearly / (monthly * 12)) * 100);
}

export function formatAmount(minorUnits: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
  }).format(minorUnits / 100);
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

/**
 * Launch promotion. Represented as configuration with an explicit cap so the
 * 21st customer cannot receive it, and so no customer-specific branch is ever
 * needed in application code.
 */
export const FOUNDING_OFFER = {
  code: 'founding-partner',
  name: 'Founding Partner',
  description: 'أول 20 شركة — 99 دولارًا شهريًا لأول 3 أشهر.',
  currency: 'USD',
  /** $99.00 */
  amount: 9900,
  durationMonths: 3,
  maxRedemptions: 20,
  /** Applies to the paid monthly plans; not to annual, which is already discounted. */
  eligiblePlanCodes: ['starter', 'growth', 'scale'] as string[],
} as const;
