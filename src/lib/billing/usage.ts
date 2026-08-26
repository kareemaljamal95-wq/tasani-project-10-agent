import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getEntitlements, EntitlementError } from './entitlements';

/**
 * Metered usage.
 *
 * An **AI action** is one billable unit of agent work: a single call to
 * `executeAgent` that reached the model and produced a decision. It is
 * deliberately a business-level unit rather than a token count —
 * `AgentRun` does not carry reliable per-provider token usage, and inventing
 * an approximation would put a number on an invoice that nobody can reproduce.
 *
 * Not counted:
 *  - policy-blocked runs. The customer is not charged for the system refusing.
 *  - runs that failed before reaching the model (no provider configured,
 *    provider outage, schema-invalid output).
 *
 * The counter is incremented by one atomic statement, so two concurrent
 * requests cannot both read the same value and step over the limit together.
 */

export const USAGE_METRIC = 'ai_actions';

/**
 * A discovery scan is one metered unit of `runDiscoveryScan`, counted
 * separately because it is not a model call. Billing a directory lookup as an
 * AI action would overstate model usage on every invoice.
 */
export const DISCOVERY_METRIC = 'discovery_scans';

/**
 * Site builds. A third metered unit, added without a schema change because
 * `UsageCounter` is keyed on (userId, periodKey, metric) rather than carrying
 * one column per capability.
 */
export const SITE_METRIC = 'site_builds';

export interface UsagePeriod {
  key: string;
  start: Date;
  end: Date;
}

/**
 * The billing period a usage counter belongs to.
 *
 * Anchored to the subscription's current period when one exists, so usage
 * resets when the customer is actually billed rather than on a calendar
 * boundary that has nothing to do with their invoice. Falls back to the
 * calendar month for accounts without period data.
 */
export function resolvePeriod(
  subscription?: { currentPeriodStart: Date | null; currentPeriodEnd: Date | null } | null,
  now = new Date(),
): UsagePeriod {
  if (subscription?.currentPeriodStart && subscription.currentPeriodEnd) {
    const start = subscription.currentPeriodStart;
    return {
      key: start.toISOString().slice(0, 10),
      start,
      end: subscription.currentPeriodEnd,
    };
  }

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return { key: start.toISOString().slice(0, 10), start, end };
}

export interface UsageSnapshot {
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  period: UsagePeriod;
  /** 80 / 90 / 100 once crossed, for the warning surface. */
  threshold: 80 | 90 | 100 | null;
}

function thresholdFor(used: number, limit: number): 80 | 90 | 100 | null {
  if (limit <= 0) return null;
  const percent = (used / limit) * 100;
  if (percent >= 100) return 100;
  if (percent >= 90) return 90;
  if (percent >= 80) return 80;
  return null;
}

export async function getUsage(userId: string): Promise<UsageSnapshot> {
  const entitlements = await getEntitlements(userId);
  const subscription = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { currentPeriodStart: true, currentPeriodEnd: true },
  });

  const period = resolvePeriod(subscription);
  const limit = entitlements.limits['aiActions.monthly'];

  const counter = await prisma.usageCounter.findUnique({
    where: {
      userId_periodKey_metric: {
        userId,
        periodKey: period.key,
        metric: USAGE_METRIC,
      },
    },
  });

  const used = counter?.count ?? 0;

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    percentUsed: limit > 0 ? Math.round((used / limit) * 100) : 100,
    period,
    threshold: thresholdFor(used, limit),
  };
}

export class UsageLimitError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      `Monthly AI action limit reached (${used}/${limit}). Upgrade your plan to continue.`,
    );
    this.name = 'UsageLimitError';
  }
}

/**
 * Reserves one AI action, or refuses.
 *
 * Increment-then-check inside a single statement: the row is incremented
 * atomically and the resulting value decides. Two concurrent requests at the
 * limit therefore see different post-increment values and exactly one is
 * allowed through. Checking first and incrementing after would let both read
 * the same pre-limit value and both proceed.
 *
 * A refused reservation is rolled back so a rejected request does not consume
 * quota.
 */
export async function consumeMetric(
  userId: string,
  metric: string,
  limitKey: 'aiActions.monthly' | 'discovery.monthly' | 'sites.monthly',
): Promise<UsageSnapshot> {
  const entitlements = await getEntitlements(userId);

  if (!entitlements.active) {
    throw new EntitlementError(
      limitKey,
      entitlements.reason ?? 'An active subscription is required.',
    );
  }

  const limit = entitlements.limits[limitKey];

  const subscription = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { currentPeriodStart: true, currentPeriodEnd: true },
  });

  const period = resolvePeriod(subscription);

  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "UsageCounter"
      ("id", "userId", "periodKey", "periodStart", "periodEnd", "metric", "count", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid()::text, ${userId}, ${period.key}, ${period.start}, ${period.end}, ${metric}, 1, NOW(), NOW())
    ON CONFLICT ("userId", "periodKey", "metric") DO UPDATE
      SET "count" = "UsageCounter"."count" + 1,
          "updatedAt" = NOW()
    RETURNING "count"
  `;

  const used = rows[0]?.count ?? 1;

  if (used > limit) {
    // Give the quota back: this request is being refused, so it must not be
    // charged for.
    await prisma.usageCounter.updateMany({
      where: { userId, periodKey: period.key, metric },
      data: { count: { decrement: 1 } },
    });

    logger.warn('Usage limit reached', { userId, metric, limit });
    throw new UsageLimitError(used - 1, limit);
  }

  const threshold = thresholdFor(used, limit);

  if (threshold) {
    logger.info('Usage threshold crossed', { userId, metric, threshold, used, limit });
  }

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    percentUsed: limit > 0 ? Math.round((used / limit) * 100) : 100,
    period,
    threshold,
  };
}

/**
 * Reserves one AI action, or refuses. The metric every agent run counts against.
 */
export function consumeAiAction(userId: string): Promise<UsageSnapshot> {
  return consumeMetric(userId, USAGE_METRIC, 'aiActions.monthly');
}

/**
 * Reserves one discovery scan, or refuses.
 *
 * Separate from the AI-action budget on purpose: a scan calls a directory, not
 * a model. Exhausting discovery must leave the agent workforce usable, and
 * exhausting agent runs must not silently stop discovery.
 */
export function consumeDiscoveryScan(userId: string): Promise<UsageSnapshot> {
  return consumeMetric(userId, DISCOVERY_METRIC, 'discovery.monthly');
}

/**
 * Reserves one site build, or refuses.
 *
 * Its own budget, for the same reason discovery has one: building a page runs
 * a deterministic parser and renderer, not a model. An owner who has spent the
 * month's agent runs must still be able to deliver a site they already sold.
 */
export function consumeSiteBuild(userId: string): Promise<UsageSnapshot> {
  return consumeMetric(userId, SITE_METRIC, 'sites.monthly');
}
