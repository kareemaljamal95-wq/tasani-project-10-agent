import { env } from '@/lib/env';
import {
  DiscoveryProviderError,
  DiscoveryUnavailableError,
  type DiscoveredBusiness,
  type DiscoveryProvider,
  type DiscoverySearch,
} from '../provider';

/**
 * Google Places (Places API New) text search.
 *
 * `X-Goog-FieldMask` is required by this API and is also the privacy control:
 * the response contains exactly the fields named here and nothing else, so the
 * import cannot quietly start storing more than the product needs.
 */
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.primaryType',
  'places.rating',
  'places.userRatingCount',
].join(',');

interface PlacesResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    primaryType?: string;
    rating?: number;
    userRatingCount?: number;
  }>;
  error?: { message?: string };
}

export class GooglePlacesProvider implements DiscoveryProvider {
  readonly name = 'google_places';

  isConfigured(): boolean {
    return Boolean(env().GOOGLE_PLACES_API_KEY);
  }

  async search(input: DiscoverySearch): Promise<DiscoveredBusiness[]> {
    const apiKey = env().GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new DiscoveryUnavailableError();

    // The API caps a page at 20; asking for more silently returns 20.
    const limit = Math.min(input.limit ?? 20, 20);

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `${input.query} in ${input.location}`,
        maxResultCount: limit,
      }),
    });

    const body = (await response.json().catch(() => null)) as PlacesResponse | null;

    if (!response.ok) {
      // The provider's message can name the query but never the key; the key
      // is only ever a request header.
      throw new DiscoveryProviderError(
        body?.error?.message ?? `Places search failed with ${response.status}.`,
      );
    }

    return (body?.places ?? [])
      .filter((place) => place.id && place.displayName?.text)
      .map((place) => ({
        externalId: place.id!,
        name: place.displayName!.text!,
        phone: place.nationalPhoneNumber,
        website: place.websiteUri,
        address: place.formattedAddress,
        category: place.primaryType,
        rating: place.rating,
        ratingCount: place.userRatingCount,
      }));
  }
}
