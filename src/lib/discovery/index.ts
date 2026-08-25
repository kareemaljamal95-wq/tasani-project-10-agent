import { env } from '@/lib/env';
import { GooglePlacesProvider } from './providers/google-places';
import { OpenStreetMapProvider } from './providers/openstreetmap';
import type { DiscoveryProvider } from './provider';

/**
 * Discovery entry point. The only place a concrete source is named.
 *
 * Google Places is the better source — it publishes ratings and review counts,
 * which are two of the four signals `scoreLead` reads. But it cannot be
 * reached at all without a funded key and a billing account, and that put the
 * top of the funnel behind a payment the owner may not yet be able to make.
 *
 * So the free source is the floor, not the fallback of last resort: with no
 * key the product still finds real businesses, and adding a key later is an
 * upgrade rather than the thing that switches discovery on.
 */
let cachedProvider: DiscoveryProvider | null = null;

export function getDiscoveryProvider(): DiscoveryProvider {
  if (!cachedProvider) {
    cachedProvider = env().GOOGLE_PLACES_API_KEY
      ? new GooglePlacesProvider()
      : new OpenStreetMapProvider();
  }
  return cachedProvider;
}

/** Test seam; not used in application code. */
export function __setDiscoveryProvider(provider: DiscoveryProvider | null): void {
  cachedProvider = provider;
}

export * from './provider';
export * from './scan';
