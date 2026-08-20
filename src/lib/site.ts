/**
 * Single source of truth for public-facing product copy.
 *
 * Positioning note: the product is sold on the outcome (opportunities found,
 * turned into leads, contacted, converted into projects) rather than on the
 * number of agents that produce it. Agent count is an implementation detail,
 * not a benefit.
 */
export const SITE = {
  name: 'Tasami',
  tagline: 'من فرصة إلى مشروع',
  description:
    'تسامي يكتشف الفرص الحقيقية في سوقك، يحوّلها إلى عملاء محتملين، يتواصل معهم برسائل تعتمدها بنفسك، ويحوّل الردود إلى مشاريع مؤهلة.',

  /**
   * Set NEXT_PUBLIC_APP_URL in production; canonical and OpenGraph URLs are
   * resolved against it.
   */
  url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
} as const;
