import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Rate limiting.
 *
 * Two tiers, because they have different failure costs:
 *
 *  - `rateLimitLocal` is an in-process counter. Cheap, and fine for read-heavy
 *    endpoints where exceeding the budget briefly costs nothing.
 *
 *  - `rateLimitShared` counts in the database, so the budget holds across
 *    replicas. The in-process counter alone let N instances serve N times the
 *    intended rate, which on login means N times the credential-stuffing
 *    throughput. Sensitive endpoints use this one.
 *
 * Redis is the upgrade path once a write per request becomes too expensive;
 * the interface here is deliberately the same shape so swapping the backing
 * store is a change to this file alone.
 */

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests.');
    this.name = 'RateLimitError';
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function rateLimitLocal(identifier: string, max?: number): void {
  const config = env();
  const limit = max ?? config.RATE_LIMIT_MAX;
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }

  const existing = buckets.get(identifier);

  if (!existing || existing.resetAt <= now) {
    buckets.set(identifier, {
      count: 1,
      resetAt: now + config.RATE_LIMIT_WINDOW_MS,
    });
    return;
  }

  existing.count += 1;

  if (existing.count > limit) {
    throw new RateLimitError(Math.ceil((existing.resetAt - now) / 1000));
  }
}

/**
 * Fixed window counted in Postgres.
 *
 * The upsert is a single statement so concurrent requests increment atomically
 * rather than read-modify-writing over each other. An expired window is reset
 * in the same statement by comparing resetAt.
 */
export async function rateLimitShared(
  identifier: string,
  max: number,
  windowMs?: number,
): Promise<void> {
  const config = env();
  const window = windowMs ?? config.RATE_LIMIT_WINDOW_MS;
  const now = new Date();
  const resetAt = new Date(now.getTime() + window);

  try {
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
      VALUES (${identifier}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitCounter"."resetAt" <= ${now} THEN 1
          ELSE "RateLimitCounter"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitCounter"."resetAt" <= ${now} THEN ${resetAt}
          ELSE "RateLimitCounter"."resetAt"
        END
      RETURNING "count", "resetAt"
    `;

    const row = rows[0];
    if (!row) return;

    if (row.count > max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((new Date(row.resetAt).getTime() - now.getTime()) / 1000),
      );
      throw new RateLimitError(retryAfter);
    }
  } catch (error) {
    if (error instanceof RateLimitError) throw error;

    // A limiter outage must not take the whole API down. Fall back to the
    // in-process counter so there is still a ceiling, and make the degradation
    // visible rather than silent.
    logger.error('Shared rate limiter unavailable, falling back to local', {
      error: error instanceof Error ? error.message : String(error),
    });
    rateLimitLocal(identifier, max);
  }
}

/** Housekeeping for expired windows; safe to call from the job worker. */
export async function pruneRateLimitCounters(): Promise<number> {
  const result = await prisma.rateLimitCounter.deleteMany({
    where: { resetAt: { lt: new Date() } },
  });
  return result.count;
}
