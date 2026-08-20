import { GooglePlacesProvider } from './providers/google-places';
import type { DiscoveryProvider } from './provider';

/**
 * Discovery entry point. The only place a concrete source is named.
 */
let cachedProvider: DiscoveryProvider | null = null;

export function getDiscoveryProvider(): DiscoveryProvider {
  if (!cachedProvider) cachedProvider = new GooglePlacesProvider();
  return cachedProvider;
}

/** Test seam; not used in application code. */
export function __setDiscoveryProvider(provider: DiscoveryProvider | null): void {
  cachedProvider = provider;
}

export * from './provider';
export * from './scan';
