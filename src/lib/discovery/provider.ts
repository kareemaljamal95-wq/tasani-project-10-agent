/**
 * The discovery provider contract.
 *
 * One place names a concrete directory service. Everything downstream — the
 * scan, the import, the dedup, the metering — works against this interface, so
 * adding a second source is a file under `providers/` and a case in `index.ts`.
 *
 * Modelled on `src/lib/billing/provider.ts` for the same reason: a real
 * external service that must be substitutable in tests at the network
 * boundary, never by mocking the logic under test.
 */

export interface DiscoverySearch {
  /** What to look for, e.g. "dental clinic". */
  query: string;
  /** Where to look, as free text, e.g. "Riyadh, Saudi Arabia". */
  location: string;
  /** Search radius in metres. Providers may clamp this. */
  radiusMetres?: number;
  /** Upper bound on results. The caller's entitlement decides the real cap. */
  limit?: number;
}

/**
 * One business as the source describes it.
 *
 * Every field beyond `externalId` and `name` is optional on purpose. A
 * directory listing routinely has no email and often no website, and a record
 * that invents one is worse than a record with a gap — it sends real mail to a
 * guessed address. Nothing downstream may fill these in.
 */
export interface DiscoveredBusiness {
  /** The source's own stable id. The dedup key, with the source name. */
  externalId: string;
  name: string;
  phone?: string;
  website?: string;
  address?: string;
  /** Provider's own category label, unmodified. */
  category?: string;
  /** 0-5 where the source publishes one. Never synthesised. */
  rating?: number;
  ratingCount?: number;
}

export interface DiscoveryProvider {
  /** Stable identifier stored on the lead as `externalSource`. */
  readonly name: string;
  /** False when the provider has no credential; the caller must fail closed. */
  isConfigured(): boolean;
  search(input: DiscoverySearch): Promise<DiscoveredBusiness[]>;
}

/** Raised when discovery is requested with no provider credential. */
export class DiscoveryUnavailableError extends Error {
  constructor(message = 'No discovery provider is configured.') {
    super(message);
    this.name = 'DiscoveryUnavailableError';
  }
}

/** Raised when the provider is reachable but the request failed. */
export class DiscoveryProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryProviderError';
  }
}
