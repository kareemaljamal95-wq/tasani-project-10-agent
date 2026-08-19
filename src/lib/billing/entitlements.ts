import { SubscriptionStatus, type Subscription } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  findCatalogPlan,
  UNENTITLED_LIMITS,
  type PlanLimits,
} from './catalog';

/**
 * The single entitlement authority.
 *
 * Every paid capability resolves through `getEntitlements`. Nothing anywhere
 * compares a plan code — `if (plan === 'growth')` scattered through routes is
 * exactly how a paid feature ends up unlocked in one place and locked in
 * another.
 *
 * This runs on the server only. The client is told what it may show; it is
 * never trusted about what it may do.
 */

export interface Entitlements {
  limits: PlanLimits;
  planCode: string | null;
  planName: string | null;
  status: SubscriptionStatus | null;
  /** True when paid capabilities are currently granted. */
  active: boolean;
  /** Why access is denied, for a useful message rather than a bare 402. */
  reason?: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Which subscription states grant paid access.
 *
 *  ACTIVE    — paid and current.
 *  TRIALING  — trial in progress; real but bounded functionality.
 *  PAST_DUE  — payment failed. Access is kept during the retry window rather
 *              than cutting a paying customer off on a card hiccup; the
 *              provider's dunning decides when it becomes EXPIRED.
 *  CANCELLED — the customer paid for this period, so access lasts until
 *              currentPeriodEnd and not a moment past it.
 *  EXPIRED   — no access.
 *  SUSPENDED — no access; provider or operator halted the subscription.
 */
const ACCESS_GRANTING: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
];

export function grantsAccess(
  subscription: Pick<
    Subscription,
    'status' | 'currentPeriodEnd' | 'trialEndsAt'
  >,
  now = new Date(),
): boolean {
  if (ACCESS_GRANTING.includes(subscription.status)) {
    // A trial that has run out grants nothing, even if the row still says
    // TRIALING because no webhook has arrived yet.
    if (
      subscription.status === SubscriptionStatus.TRIALING &&
      subscription.trialEndsAt &&
      subscription.trialEndsAt <= now
    ) {
      return false;
    }
    return true;
  }

  if (subscription.status === SubscriptionStatus.CANCELLED) {
    return Boolean(
      subscription.currentPeriodEnd && subscription.currentPeriodEnd > now,
    );
  }

  return false;
}

/** Returns the subscription that currently governs an account, if any. */
export async function getActiveSubscription(
  userId: string,
): Promise<Subscription | null> {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return subscriptions.find((s) => grantsAccess(s)) ?? subscriptions[0] ?? null;
}

export async function getEntitlements(userId: string): Promise<Entitlements> {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    return {
      limits: UNENTITLED_LIMITS,
      planCode: null,
      planName: null,
      status: null,
      active: false,
      reason: 'No subscription. Choose a plan to activate Tasami.',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  const plan = await prisma.plan.findUnique({
    where: { id: subscription.planId },
  });

  const active = grantsAccess(subscription);

  // Limits come from the catalog when the code knows the plan, falling back to
  // the row's stored limits so an older plan a customer still pays for keeps
  // working after it is retired from the catalog.
  const catalogPlan = plan ? findCatalogPlan(plan.code) : undefined;
  const limits = active
    ? (catalogPlan?.limits ?? (plan?.limits as unknown as PlanLimits) ?? UNENTITLED_LIMITS)
    : UNENTITLED_LIMITS;

  return {
    limits,
    planCode: plan?.code ?? null,
    planName: plan?.name ?? null,
    status: subscription.status,
    active,
    reason: active ? undefined : reasonFor(subscription.status),
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}

function reasonFor(status: SubscriptionStatus): string {
  switch (status) {
    case SubscriptionStatus.EXPIRED:
      return 'Subscription expired. Renew to restore access.';
    case SubscriptionStatus.SUSPENDED:
      return 'Subscription suspended. Contact support or update billing.';
    case SubscriptionStatus.CANCELLED:
      return 'Subscription cancelled and the paid period has ended.';
    case SubscriptionStatus.TRIALING:
      return 'Trial has ended. Choose a plan to continue.';
    default:
      return 'Subscription is not active.';
  }
}

/** Raised when a paid capability is used without entitlement. */
export class EntitlementError extends Error {
  constructor(
    readonly capability: string,
    message: string,
  ) {
    super(message);
    this.name = 'EntitlementError';
  }
}

/**
 * Enforces a boolean capability. Throws rather than returning a flag so a
 * forgotten check cannot silently pass.
 */
export async function requireCapability(
  userId: string,
  capability: 'leads.enabled' | 'approvals.enabled' | 'advancedAutomation.enabled',
): Promise<Entitlements> {
  const entitlements = await getEntitlements(userId);

  if (!entitlements.active) {
    throw new EntitlementError(
      capability,
      entitlements.reason ?? 'An active subscription is required.',
    );
  }

  if (!entitlements.limits[capability]) {
    throw new EntitlementError(
      capability,
      `Your ${entitlements.planName ?? 'current'} plan does not include this feature.`,
    );
  }

  return entitlements;
}

/**
 * Enforces a countable limit against what already exists.
 *
 * `current` is supplied by the caller because the thing being counted differs
 * (enabled agents, enabled triggers), and counting it here would couple this
 * module to every table it governs.
 */
export async function requireWithinLimit(
  userId: string,
  limit: 'agents.max' | 'automations.max' | 'seats.max',
  current: number,
): Promise<Entitlements> {
  const entitlements = await getEntitlements(userId);

  if (!entitlements.active) {
    throw new EntitlementError(
      limit,
      entitlements.reason ?? 'An active subscription is required.',
    );
  }

  const max = entitlements.limits[limit];

  if (current >= max) {
    throw new EntitlementError(
      limit,
      `Your ${entitlements.planName ?? 'current'} plan allows ${max}. Upgrade to add more.`,
    );
  }

  return entitlements;
}
