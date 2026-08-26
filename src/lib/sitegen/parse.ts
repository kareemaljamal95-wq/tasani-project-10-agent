import {
  present,
  sealProfile,
  type BusinessProfile,
  type OpeningHours,
  type Service,
} from './profile';

/**
 * Raw pasted text into a business profile.
 *
 * Deliberately deterministic — no model call. Text copied out of a maps
 * listing is far more structured than it looks: a name on the first line, a
 * rating followed by a review count in brackets, a category, an address with a
 * recognisable shape, a phone number, opening hours. Regular expressions read
 * all of that at zero cost, run in a millisecond, and can be tested exhaustively
 * against real input.
 *
 * That matters beyond elegance. An importer that needs an inference call per
 * paste costs money on every use, and this platform has to be usable by an
 * owner who has not paid for a model yet.
 *
 * The parser's one rule: **read, never infer**. A field that cannot be read
 * from the text is left absent and recorded in `missing`. It does not guess a
 * category from the name, a city from a phone prefix, or an opening time from
 * what such businesses "usually" do.
 */

/** A rating, with the review count that usually trails it in brackets. */
const RATING = /(\d[.,]\d)\s*(?:★|stars?|نجوم?)?\s*(?:\(([\d.,\s]+)\))?/u;

/**
 * A run that could be a phone number, validated by digit count afterwards.
 *
 * Written loose on purpose. A stricter pattern anchored on the local part
 * matched from the middle of the string and silently dropped the country
 * code, turning "+966 11 456 7890" into "11 456 7890" — a number that cannot
 * be dialled from outside the country, which is exactly who a generated site
 * is for.
 */
const PHONE_CANDIDATE = /\+?\d[\d\s\-().]{5,20}\d/u;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/u;

const URL = /\b(?:https?:\/\/|www\.)[^\s<>"']+/iu;

/** "9:00 - 17:00", "٩ ص - ٥ م", "09:00–22:00". */
const TIME_RANGE = /(\d{1,2}(?::\d{2})?\s*(?:ص|م|AM|PM)?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:ص|م|AM|PM)?)/iu;

/** Day names that commonly open an hours line, in both languages. */
const DAY_WORDS =
  /(الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|يوميًا|يومياً|كل ي��م|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Daily|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/iu;

/** Currency amounts. Read only — never attached to a service that lacks one. */
const PRICE = /(\d[\d.,]*)\s*(ر\.?س|ريال|SAR|SR|\$|USD|AED|درهم|د\.إ)|(?:ر\.?س|ريال|SAR|SR|\$|USD)\s*(\d[\d.,]*)/iu;

/** Lines that are navigation chrome in a copied listing, not business data. */
const CHROME =
  /^(?:الاتجاهات|حفظ|مشاركة|قريب|إرسال إلى|المزيد|Directions|Save|Share|Nearby|Send to|Website|Call|More|Overview|Reviews|Photos|About|Updates)$/iu;

const ARABIC = /[؀-ۿ]/u;

function cleanLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && !CHROME.test(l));
}

/** Arabic-Indic digits normalised so numeric fields parse either way. */
function westernDigits(value: string): string {
  return value.replace(/[٠-٩]/gu, (d) =>
    String(d.charCodeAt(0) - 0x0660),
  );
}

function parseRating(lines: string[]): { rating?: number; ratingCount?: number } {
  for (const line of lines) {
    // Require a review count or an explicit star marker: a bare "4.5" in an
    // address or a price would otherwise be read as a rating.
    const m = westernDigits(line).match(RATING);
    if (!m) continue;

    const value = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 5) continue;

    const countRaw = m[2]?.replace(/[^\d]/g, '');
    const count = countRaw ? Number(countRaw) : undefined;

    if (count === undefined && !/★|stars?|نجوم?/iu.test(line)) continue;

    return { rating: value, ratingCount: Number.isFinite(count) ? count : undefined };
  }
  return {};
}

function parseHours(lines: string[]): OpeningHours[] {
  const found: OpeningHours[] = [];

  for (const line of lines) {
    const normalised = westernDigits(line);
    const range = normalised.match(TIME_RANGE);
    if (!range) continue;

    const day = normalised.match(DAY_WORDS);
    found.push({
      // When no day is named the source really did say "these are the hours",
      // so that is what is recorded — not an invented Sunday-to-Thursday week.
      days: day ? normalised.slice(0, range.index).trim() || day[0] : 'ساعات العمل',
      hours: `${range[1].trim()} - ${range[2].trim()}`,
    });
  }

  return found;
}

/**
 * Service lines.
 *
 * A price is attached only when it sits on the same line as the service. A
 * price found elsewhere in the text belongs to something unknown, and guessing
 * which service it belongs to is exactly the invention this parser refuses.
 */
function parseServices(lines: string[]): Service[] {
  const services: Service[] = [];

  for (const line of lines) {
    const bullet = line.match(/^(?:[-*•·—]|\d+[.)])\s*(.+)$/u);
    if (!bullet) continue;

    const body = bullet[1].trim();
    if (body.length < 2 || body.length > 120) continue;

    const priceMatch = westernDigits(body).match(PRICE);
    const price = priceMatch ? priceMatch[0].trim() : undefined;

    const name = price
      ? body.replace(/\s*[-–—:]\s*$/u, '').replace(priceMatch![0], '').replace(/\s*[-–—:]\s*$/u, '').trim()
      : body;

    if (name.length > 0) services.push(price ? { name, price } : { name });
  }

  return services;
}

/**
 * An address line: has a street-ish or place-ish marker and is not something
 * already claimed by another field.
 */
function parseAddress(lines: string[]): string | undefined {
  const marker =
    /(شارع|طريق|حي|مبنى|ص\.ب|الرياض|جدة|الدمام|مكة|المدينة|Street|St\.|Road|Rd\.|Ave|Avenue|Building|Block|Floor|P\.O)/iu;

  for (const line of lines) {
    if (!marker.test(line)) continue;
    if (EMAIL.test(line) || URL.test(line)) continue;
    if (TIME_RANGE.test(westernDigits(line))) continue;
    if (line.length > 200) continue;
    return line;
  }
  return undefined;
}

/**
 * The first line that holds a plausible phone number.
 *
 * Length is the discriminator: 8 to 15 digits is a phone, while a rating, a
 * postcode or a price is shorter and a long id is longer.
 */
function findPhone(lines: string[]): string | undefined {
  for (const line of lines) {
    const normalised = westernDigits(line);
    if (EMAIL.test(normalised) || URL.test(normalised)) continue;
    if (TIME_RANGE.test(normalised)) continue;

    const m = normalised.match(PHONE_CANDIDATE);
    if (!m) continue;

    const digits = m[0].replace(/\D/g, '').length;
    if (digits < 8 || digits > 15) continue;

    return m[0].trim();
  }
  return undefined;
}

function firstMatch(lines: string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const m = westernDigits(line).match(pattern);
    if (m) return m[0].trim();
  }
  return undefined;
}

export interface ParseInput {
  raw: string;
  /** Overrides the parsed name; used when importing from a known lead. */
  name?: string;
  locale?: 'ar' | 'en';
}

export class EmptySourceError extends Error {
  constructor() {
    super('لا يوجد نص لتحليله. الصق بيانات النشاط أولًا.');
    this.name = 'EmptySourceError';
  }
}

export function parseBusiness(input: ParseInput): BusinessProfile {
  const lines = cleanLines(input.raw);

  if (lines.length === 0 && !present(input.name)) throw new EmptySourceError();

  const name = present(input.name) ? input.name.trim() : lines[0];
  if (!present(name)) throw new EmptySourceError();

  // Everything after the name; the name line is not re-read as data about
  // itself, which otherwise turns a business called "Cafe 24/7" into hours.
  const body = present(input.name) ? lines : lines.slice(1);

  const { rating, ratingCount } = parseRating(body);
  const website = firstMatch(body, URL);

  // The category is the first short line that carries no other signal — the
  // slot a listing puts it in. When nothing qualifies, none is recorded.
  const category = body.find(
    (l) =>
      l.length <= 40 &&
      !EMAIL.test(l) &&
      !URL.test(l) &&
      !PHONE_CANDIDATE.test(westernDigits(l)) &&
      !TIME_RANGE.test(westernDigits(l)) &&
      !RATING.test(westernDigits(l)) &&
      !/^[-*•·—\d]/u.test(l),
  );

  const locale =
    input.locale ?? (ARABIC.test(input.raw) || ARABIC.test(name) ? 'ar' : 'en');

  return sealProfile({
    name,
    category,
    services: parseServices(body),
    hours: parseHours(body),
    phone: findPhone(body),
    email: firstMatch(body, EMAIL),
    address: parseAddress(body),
    website,
    rating,
    ratingCount,
    locale,
  });
}
