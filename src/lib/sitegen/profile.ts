/**
 * The single source of truth for a generated site.
 *
 * Every field is optional except the name, because the raw text this is parsed
 * from — a listing copied out of a maps app, a scribbled note — routinely
 * carries only some of them. What matters is that absence is *recorded* rather
 * than filled in: `missing` names every field the source did not provide, and
 * the renderer draws those as visible requests for data.
 *
 * That is the whole design. A generated page must never contain a price, an
 * opening hour or a service the business did not state. A plausible invention
 * is worse than an obvious gap: the gap gets filled in a minute, while the
 * invention gets sent to a real customer and becomes a lie told in their name.
 */

/** Fields a site can be missing. Used as keys, so they are stable strings. */
export const PROFILE_FIELDS = [
  'tagline',
  'about',
  'services',
  'prices',
  'hours',
  'phone',
  'email',
  'address',
  'website',
  'rating',
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface OpeningHours {
  /** As written in the source, e.g. "الأحد - الخميس". Never normalised into a
   *  week the source did not describe. */
  days: string;
  hours: string;
}

export interface Service {
  name: string;
  /** Only when the source stated one. There is no default price. */
  price?: string;
  description?: string;
}

export interface BusinessProfile {
  /** The one field a site cannot be built without. */
  name: string;

  category?: string;
  tagline?: string;
  about?: string;

  services: Service[];
  hours: OpeningHours[];

  phone?: string;
  email?: string;
  whatsapp?: string;
  address?: string;
  website?: string;

  /** As published by the source. Never synthesised, never rounded up. */
  rating?: number;
  ratingCount?: number;

  /** Language of the generated page. Drives `lang` and `dir`. */
  locale: 'ar' | 'en';

  /**
   * Fields the source did not provide. The renderer turns each into a visible
   * slot the owner fills, which is why this is part of the profile rather than
   * something recomputed later: the page and the gap list cannot disagree.
   */
  missing: ProfileField[];
}

/** True when the value is a string with something in it. */
export function present(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Derives `missing` from what the profile actually holds.
 *
 * Kept separate from parsing so any producer — the text parser, a manual form,
 * a future importer — ends up with the same honest gap list.
 */
export function findGaps(
  profile: Omit<BusinessProfile, 'missing'>,
): ProfileField[] {
  const gaps: ProfileField[] = [];

  if (!present(profile.tagline)) gaps.push('tagline');
  if (!present(profile.about)) gaps.push('about');
  if (profile.services.length === 0) gaps.push('services');
  if (!profile.services.some((s) => present(s.price))) gaps.push('prices');
  if (profile.hours.length === 0) gaps.push('hours');
  if (!present(profile.phone)) gaps.push('phone');
  if (!present(profile.email)) gaps.push('email');
  if (!present(profile.address)) gaps.push('address');
  if (!present(profile.website)) gaps.push('website');
  if (typeof profile.rating !== 'number') gaps.push('rating');

  return gaps;
}

/** Attaches the gap list, producing a complete profile. */
export function sealProfile(
  profile: Omit<BusinessProfile, 'missing'>,
): BusinessProfile {
  return { ...profile, missing: findGaps(profile) };
}
