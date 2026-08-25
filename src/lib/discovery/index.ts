import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { GooglePlacesProvider } from './providers/google-places';
import { OpenStreetMapProvider } from './providers/openstreetmap';
import {
  DiscoveryProviderError,
  DiscoveryUnavailableError,
  type DiscoveredBusiness,
  type DiscoveryProvider,
  type DiscoverySearch,
} from './provider';

/**
 * Discovery entry point. The only place a concrete source is named.
 *
 * Sources are tried in order, the same shape the AI provider chain uses. Google
 * Places leads when a key exists — it publishes ratings and review counts, two
 * of the four signals `scoreLead` reads. OpenStreetMap always follows, because
 * it needs no key, no billing account and no card.
 *
 * The order matters more than it looks. Places is unreachable without a
 * *funded* key, and a key that exists but is not funded fails exactly like one
 * that is missing — which previously took the whole top of the funnel down.
 * A free source behind it means discovery degrades instead of stopping.
 */

class ChainedDiscovery implements DiscoveryProvider {
  constructor(private readonly chain: DiscoveryProvider[]) {}

  /** The chain always ends in a source with no credential to be missing. */
  get name(): string {
    return this.chain[this.chain.length - 1]?.name ?? 'none';
  }

  isConfigured(): boolean {
    return this.chain.some((p) => p.isConfigured());
  }

  async search(input: DiscoverySearch): Promise<DiscoveredBusiness[]> {
    let last: unknown;

    for (const provider of this.chain) {
      if (!provider.isConfigured()) continue;

      try {
        const results = await provider.search(input);
        // An empty result from a working source is an answer, not a failure:
        // some markets really do have nothing matching. Only an error moves on.
        return results;
      } catch (error) {
        last = error;
        logger.warn('Discovery source failed, trying the next', {
          source: provider.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw last instanceof Error
      ? last
      : new DiscoveryUnavailableError('No discovery source is available.');
  }
}

let cachedProvider: DiscoveryProvider | null = null;

export function getDiscoveryProvider(): DiscoveryProvider {
  if (!cachedProvider) {
    const chain: DiscoveryProvider[] = [];
    if (env().GOOGLE_PLACES_API_KEY) chain.push(new GooglePlacesProvider());
    chain.push(new OpenStreetMapProvider());
    cachedProvider = new ChainedDiscovery(chain);
  }
  return cachedProvider;
}

/** Test seam; not used in application code. */
export function __setDiscoveryProvider(provider: DiscoveryProvider | null): void {
  cachedProvider = provider;
}

export { DiscoveryProviderError };
export * from './provider';
export * from './scan';
