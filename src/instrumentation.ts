/**
 * Server startup hook.
 *
 * Projects the plan catalog into the database when the server boots.
 *
 * This exists because the catalog had no way to reach production. `checkout.ts`
 * resolves a price through `prisma.plan` and `prisma.price`, but those rows only
 * appear after `syncCatalog()` runs — and nothing ran it: `docker-entrypoint.sh`
 * applies migrations and starts the server, while `npm run db:catalog` goes
 * through `tsx`, a devDependency that `npm ci --omit=dev` strips from the image.
 *
 * The failure was invisible. `/api/billing/plans` reads PLAN_CATALOG from code,
 * so the pricing page rendered perfectly while every checkout would have failed
 * on a missing plan row — a product that looks purchasable and is not.
 *
 * `syncCatalog` is idempotent by design (it never resets an offer's redemption
 * count and never clears a provider price id), so running it on every boot is
 * safe, including across several replicas.
 */
export async function register() {
  // Only the Node server runtime touches the database; the edge runtime has no
  // Prisma client and must not attempt this.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { syncCatalog } = await import('@/lib/billing');
  const { logger } = await import('@/lib/logger');

  try {
    const result = await syncCatalog();
    logger.info('Plan catalog synced', result);
  } catch (error) {
    // Deliberately not fatal. A failed sync leaves checkout broken, which is
    // bad — but refusing to boot takes down signup, login, agents and the
    // dashboard too, which is worse. It is logged at error level so the cause
    // is visible rather than silent.
    logger.error('Plan catalog sync failed — checkout will not resolve prices', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
