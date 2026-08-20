import { logger } from '@/lib/logger';
import { recordAudit } from '@/lib/audit';
import { createLead, DuplicateLeadError } from '@/lib/leads';
import { requireCapability } from '@/lib/billing/entitlements';
import { consumeDiscoveryScan } from '@/lib/billing/usage';
import { getDiscoveryProvider } from './index';
import {
  DiscoveryUnavailableError,
  type DiscoveredBusiness,
  type DiscoverySearch,
} from './provider';

/**
 * A discovery scan: search a directory for real businesses in a market and
 * import them as leads.
 *
 * Order matters and mirrors `executeAgent`:
 *
 *  1. entitlement — a plan without discovery is refused before anything else,
 *     so an unentitled account cannot learn whether a provider is configured;
 *  2. provider availability — refuse rather than invent;
 *  3. meter — reserve the scan only once it is actually going to happen;
 *  4. search, then import.
 *
 * The meter sits after the provider check on purpose. Charging a customer for
 * a scan that could never run because the operator has not set a key would be
 * charging them for our misconfiguration.
 */

export interface ScanResult {
  found: number;
  imported: number;
  duplicates: number;
  leadIds: string[];
}

export interface RunScanInput extends DiscoverySearch {
  userId: string;
  actor: string;
}

/**
 * A directory listing is not a contact record. Only fields the source actually
 * published are carried over; nothing is derived, guessed or defaulted into a
 * value that would be acted on as if it were real.
 *
 * Note there is no email. Places does not publish one, and a generated
 * `info@domain` guess would put a real message in front of a real business at
 * an address nobody verified.
 */
function toLeadInput(
  business: DiscoveredBusiness,
  source: string,
  input: RunScanInput,
) {
  const notes = [
    business.address,
    business.category ? `Category: ${business.category}` : null,
    typeof business.rating === 'number'
      ? `Rating: ${business.rating}${business.ratingCount ? ` (${business.ratingCount})` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    userId: input.userId,
    actor: input.actor,
    companyName: business.name,
    phone: business.phone,
    website: business.website,
    notes: notes || undefined,
    source: `discovery:${source}`,
    externalSource: source,
    externalId: business.externalId,
    assignedAgent: 'DISCOVERY',
  };
}

export async function runDiscoveryScan(input: RunScanInput): Promise<ScanResult> {
  await requireCapability(input.userId, 'discovery.enabled');

  const provider = getDiscoveryProvider();

  if (!provider.isConfigured()) {
    throw new DiscoveryUnavailableError(
      'Business discovery is not configured on this instance.',
    );
  }

  await consumeDiscoveryScan(input.userId);

  const businesses = await provider.search({
    query: input.query,
    location: input.location,
    radiusMetres: input.radiusMetres,
    limit: input.limit,
  });

  const result: ScanResult = {
    found: businesses.length,
    imported: 0,
    duplicates: 0,
    leadIds: [],
  };

  for (const business of businesses) {
    try {
      const lead = await createLead(toLeadInput(business, provider.name, input));
      result.imported += 1;
      result.leadIds.push(lead.id);
    } catch (error) {
      // Already imported — by a previous scan, or by hand under the same
      // email. Expected on any re-scan and not a failure of the scan.
      if (error instanceof DuplicateLeadError) {
        result.duplicates += 1;
        continue;
      }
      throw error;
    }
  }

  logger.info('Discovery scan complete', {
    userId: input.userId,
    source: provider.name,
    ...result,
    leadIds: undefined,
  });

  // Through recordAudit rather than prisma directly, so the payload goes
  // through the same redaction every other audit entry does. The query and
  // location are the customer's own search terms; no provider credential is
  // recorded anywhere.
  await recordAudit({
    userId: input.userId,
    type: 'discovery_scan',
    actor: input.actor,
    message: `Discovery scan: ${result.imported} imported, ${result.duplicates} already known.`,
    data: {
      source: provider.name,
      query: input.query,
      location: input.location,
      found: result.found,
      imported: result.imported,
      duplicates: result.duplicates,
    },
  });

  return result;
}
