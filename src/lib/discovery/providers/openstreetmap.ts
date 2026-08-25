import { logger } from '@/lib/logger';
import {
  DiscoveryProviderError,
  type DiscoveredBusiness,
  type DiscoveryProvider,
  type DiscoverySearch,
} from '../provider';

/**
 * OpenStreetMap discovery, via Nominatim and Overpass.
 *
 * Exists so an account can find real businesses with **no API key, no billing
 * account and no card on file**. Google Places is the better source when a
 * funded key exists, but it cannot be reached at all without one, which put
 * the whole top of the funnel behind a payment the owner may not be able to
 * make yet.
 *
 * Two honest limitations, both left visible rather than papered over:
 *
 *  - OSM publishes **no ratings**. `rating` and `ratingCount` stay undefined,
 *    so `scoreLead` reports "no rating published" instead of inventing one.
 *  - Coverage is contributor-driven and thinner than Google's in some
 *    regions. A thin result is reported as a thin result.
 *
 * Both services are free and community-run, so this is a polite client: a
 * descriptive User-Agent as their policy requires, a bounded timeout, and no
 * retry storm.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
/**
 * Overpass mirrors, tried in order.
 *
 * These are volunteer-run and individually shed load — a 503 from one is
 * routine, not an outage. Trying the next is what makes a free source
 * dependable enough to build on.
 */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Their acceptable-use policy requires identifying the application.
const UA = 'Tasami/1.0 (business discovery; +https://web--web--rpsnqydlz8bs.code.run)';

const TIMEOUT_MS = 25_000;

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Overpass takes a regex, so anything with regex meaning in the customer's own
 * search terms has to be neutralised before it reaches the query.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
}

function addressOf(tags: Record<string, string>): string | undefined {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:district'],
    tags['addr:city'],
  ].filter((p) => p && p.length > 0);

  return parts.length > 0 ? parts.join('، ') : undefined;
}

function categoryOf(tags: Record<string, string>): string | undefined {
  return tags.amenity ?? tags.shop ?? tags.office ?? tags.healthcare ?? tags.craft;
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class OpenStreetMapProvider implements DiscoveryProvider {
  readonly name = 'openstreetmap';

  /** Always available: there is no credential to be missing. */
  isConfigured(): boolean {
    return true;
  }

  private async geocode(location: string): Promise<{ lat: number; lon: number }> {
    const url = `${NOMINATIM}?q=${encodeURIComponent(location)}&format=json&limit=1`;

    const response = await withTimeout(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ar,en' },
    });

    if (!response.ok) {
      throw new DiscoveryProviderError(
        `Could not resolve the location (HTTP ${response.status}).`,
      );
    }

    const places = (await response.json().catch(() => [])) as NominatimPlace[];
    const first = places[0];

    if (!first) {
      // Not an error in our stack — the customer named a place the map does
      // not know. Say that, rather than returning an empty list silently.
      throw new DiscoveryProviderError(
        `لم يُعثر على الموقع "${location}" على الخريطة. جرّب اسمًا أوسع، مثل اسم المدينة.`,
      );
    }

    return { lat: Number(first.lat), lon: Number(first.lon) };
  }

  async search(input: DiscoverySearch): Promise<DiscoveredBusiness[]> {
    const { lat, lon } = await this.geocode(input.location);

    const radius = Math.min(Math.max(input.radiusMetres ?? 15_000, 500), 50_000);
    const limit = Math.min(input.limit ?? 20, 50);
    const q = escapeRegex(input.query.trim());

    // Matches the search term against the common business tags and against the
    // name itself, so "عيادة أسنان" finds both `amenity=dentist` and a shop
    // that simply carries the words in its name.
    const query = `
[out:json][timeout:${Math.floor(TIMEOUT_MS / 1000)}];
(
  nwr["name"]["amenity"~"${q}",i](around:${radius},${lat},${lon});
  nwr["name"]["shop"~"${q}",i](around:${radius},${lat},${lon});
  nwr["name"]["office"~"${q}",i](around:${radius},${lat},${lon});
  nwr["name"]["healthcare"~"${q}",i](around:${radius},${lat},${lon});
  nwr["name"~"${q}",i](around:${radius},${lat},${lon});
);
out center tags ${limit};`;

    type OverpassBody = { elements?: OverpassElement[] };
    let body: OverpassBody | null = null;
    let lastStatus = 0;

    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const response = await withTimeout(mirror, {
          method: 'POST',
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `data=${encodeURIComponent(query)}`,
        });

        lastStatus = response.status;

        if (!response.ok) {
          logger.warn('Overpass mirror unavailable, trying the next', {
            status: response.status,
          });
          continue;
        }

        body = (await response.json().catch(() => null)) as OverpassBody | null;
        if (body) break;
      } catch (error) {
        logger.warn('Overpass mirror unreachable, trying the next', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!body) {
      // Every mirror refused. Fail closed and say so plainly, rather than
      // returning an empty list that reads as "this market has no businesses".
      throw new DiscoveryProviderError(
        lastStatus === 429 || lastStatus === 504 || lastStatus === 503
          ? 'خدمة الخرائط المجانية مشغولة الآن. أعد المحاولة بعد دقيقة.'
          : 'تعذّر الوصول إلى خدمة الخرائط المجانية.',
      );
    }

    const seen = new Set<string>();
    const results: DiscoveredBusiness[] = [];

    for (const el of body?.elements ?? []) {
      const tags = el.tags;
      const name = tags?.name?.trim();
      if (!tags || !name) continue;

      // One business can exist in OSM as both a node and an enclosing way.
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        externalId: `${el.type}/${el.id}`,
        name,
        phone: tags.phone ?? tags['contact:phone'],
        website: tags.website ?? tags['contact:website'],
        address: addressOf(tags),
        category: categoryOf(tags),
        // No rating: OSM does not publish one, and a guessed score attached to
        // a real business is worse than an admitted gap.
      });

      if (results.length >= limit) break;
    }

    logger.info('OpenStreetMap discovery complete', {
      found: results.length,
      radius,
    });

    return results;
  }
}
