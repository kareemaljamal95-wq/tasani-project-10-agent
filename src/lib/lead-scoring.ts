/**
 * Opportunity scoring for leads.
 *
 * Deliberately a pure function and not an AI call. The score is a claim about
 * a real, named business, so every point of it has to trace back to a field
 * the source actually published — the same rule the Discovery agent works
 * under. A model asked to "score this company 0-100" would produce a
 * confident number with nothing behind it, which is the one thing this
 * codebase does not do.
 *
 * Being pure also means it is free, deterministic, and recomputable: a lead
 * scored at import can be rescored later without another provider call.
 */

/**
 * The scoring inputs. All optional, because a directory listing routinely
 * publishes only some of them. Null and undefined both mean "the source said
 * nothing" — never zero, and never treated as a bad value.
 */
export interface ScorableLead {
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  /** 0-5 as published. */
  rating?: number | null;
  ratingCount?: number | null;
}

export type LeadGrade = 'A' | 'B' | 'C';

export interface LeadScore {
  /** 0-100. Higher means a larger addressable gap. */
  score: number;
  grade: LeadGrade;
  /** One line per signal that moved the score, in the UI's language. */
  reasons: string[];
}

/**
 * Grade thresholds. Derived from the score rather than stored on the row: a
 * stored grade would go stale the moment these move, and there is nothing a
 * column buys that a score range on the existing index does not.
 */
export const GRADE_THRESHOLDS = { A: 70, B: 40 } as const;

export function gradeFor(score: number): LeadGrade {
  if (score >= GRADE_THRESHOLDS.A) return 'A';
  if (score >= GRADE_THRESHOLDS.B) return 'B';
  return 'C';
}

function hasText(value?: string | null): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** Arabic counts inflect by size, so "5 تقييمات" but "25 تقييمًا". */
function reviewWord(n: number): string {
  if (n === 1) return 'تقييم';
  if (n === 2) return 'تقييمان';
  if (n <= 10) return 'تقييمات';
  return 'تقييمًا';
}

/**
 * Weights, stated once so the maximum is checkable by eye: 45 + 15 + 25 + 15
 * = 100. Clamped anyway, so a later weight change cannot silently produce an
 * out-of-range score.
 */
const WEIGHT = {
  noWebsite: 45,
  reachable: 15,
  proof: { established: 25, growing: 18, some: 10, minimal: 5 },
  reputation: { weak: 15, average: 10, strong: 8 },
} as const;

/**
 * Score one lead.
 *
 * The four signals answer four different questions: is there a gap to sell
 * into, can we actually reach them, is this a real business, and is their
 * reputation an opening. A missing signal contributes nothing and says so —
 * it never counts as a negative, because absence of data is not evidence.
 */
export function scoreLead(lead: ScorableLead): LeadScore {
  const reasons: string[] = [];
  let score = 0;

  // A record the source told us nothing about scores nothing. Otherwise an
  // empty row would collect the full no-website weight and read as the best
  // opportunity in the list, when in truth it has never been looked at — an
  // absent field is not the same claim as an observed absence.
  const observed =
    hasText(lead.website) ||
    hasText(lead.phone) ||
    hasText(lead.email) ||
    typeof lead.rating === 'number' ||
    typeof lead.ratingCount === 'number';

  if (!observed) {
    return {
      score: 0,
      grade: gradeFor(0),
      reasons: ['لا توجد بيانات منشورة عن هذا النشاط بعد — لم يُقيَّم'],
    };
  }

  // The core digital gap. A business with no website is the whole premise of
  // the product, so it carries the largest single weight.
  if (hasText(lead.website)) {
    reasons.push('لديها موقع إلكتروني — الفجوة الرقمية أصغر');
  } else {
    score += WEIGHT.noWebsite;
    reasons.push('لا يوجد موقع إلكتروني — أكبر فرصة');
  }

  // Actionability. A lead nobody can contact is not an opportunity yet,
  // however large its gap.
  if (hasText(lead.phone) || hasText(lead.email)) {
    score += WEIGHT.reachable;
    reasons.push(hasText(lead.phone) ? 'يوجد رقم هاتف للتواصل' : 'يوجد بريد إلكتروني للتواصل');
  } else {
    reasons.push('لا توجد وسيلة تواصل منشورة');
  }

  // Review volume as proof the business is real and trading. Counts, not
  // stars — a hundred reviews is a signal regardless of what they say.
  const count = typeof lead.ratingCount === 'number' ? lead.ratingCount : null;
  if (count === null) {
    reasons.push('لا توجد تقييمات منشورة');
  } else if (count >= 100) {
    score += WEIGHT.proof.established;
    reasons.push(`${count} ${reviewWord(count)} — نشاط قائم وراسخ`);
  } else if (count >= 25) {
    score += WEIGHT.proof.growing;
    reasons.push(`${count} ${reviewWord(count)} — نشاط نامٍ`);
  } else if (count >= 5) {
    score += WEIGHT.proof.some;
    reasons.push(`${count} ${reviewWord(count)} — حضور محدود`);
  } else if (count > 0) {
    score += WEIGHT.proof.minimal;
    reasons.push(`${count} ${reviewWord(count)} فقط — حضور ضعيف`);
  } else {
    reasons.push('لا توجد تقييمات منشورة');
  }

  // Reputation. A weak rating is an opening for reputation work; a strong one
  // marks a business worth approaching. Both are opportunities, so both score
  // — the weak case scores higher because the need is more urgent.
  const rating = typeof lead.rating === 'number' ? lead.rating : null;
  if (rating === null) {
    reasons.push('لا يوجد تقييم منشور');
  } else if (rating < 4.0) {
    score += WEIGHT.reputation.weak;
    reasons.push(`التقييم ${rating} — تحسين السمعة فرصة واضحة`);
  } else if (rating < 4.5) {
    score += WEIGHT.reputation.average;
    reasons.push(`التقييم ${rating} — مجال للتحسين`);
  } else {
    score += WEIGHT.reputation.strong;
    reasons.push(`التقييم ${rating} — نشاط قوي يستحق التواصل`);
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return { score: clamped, grade: gradeFor(clamped), reasons };
}

/**
 * True when a change touches something `scoreLead` reads, so callers can
 * avoid rescoring on an unrelated edit such as a note or a status move.
 */
export function affectsScore(updates: Partial<ScorableLead>): boolean {
  return (
    'website' in updates ||
    'phone' in updates ||
    'email' in updates ||
    'rating' in updates ||
    'ratingCount' in updates
  );
}
