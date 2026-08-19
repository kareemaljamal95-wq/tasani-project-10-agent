/**
 * Projects the code catalog (plans, prices, offers) into the database.
 *
 * Idempotent and safe to run on every deploy. It never resets an offer's
 * redemption count and never clears a provider price id — both are live state
 * rather than catalog state.
 *
 * Run with: npm run db:catalog
 */
import { syncCatalog } from '../src/lib/billing/index';
import { logger } from '../src/lib/logger';

async function main(): Promise<void> {
  const result = await syncCatalog();
  logger.info('Billing catalog synced', result);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Catalog sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
