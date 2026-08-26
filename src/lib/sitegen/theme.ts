/**
 * The design system a generated site is built from.
 *
 * Expressed as CSS custom properties rather than utility classes, and that is
 * a deliberate reading of "open design". A generated site should open in any
 * text editor and change with one edit — a themeable file with a token block at
 * the top does that; a file of utility classes needs the toolchain that
 * produced it. Openness here means *editable by the recipient*, not merely
 * built from an open-source library.
 *
 * Every token is documented in the generated output itself, so the person who
 * receives the file can see what to change without reading this source.
 */

export interface Theme {
  id: string;
  /** Shown in the picker. */
  label: string;
  /** One line on when this theme suits a business. */
  note: string;
  tokens: {
    ground: string;
    surface: string;
    ink: string;
    muted: string;
    line: string;
    brand: string;
    brandInk: string;
    accent: string;
  };
  /** Display face and body face, in that order. Both from Google Fonts. */
  fonts: { display: string; body: string };
  /** Corner radius of cards and buttons. */
  radius: string;
}

/**
 * Four themes rather than one generator that mixes colours at random.
 *
 * A random palette produces a page that looks generated. A small set of
 * complete, deliberate schemes produces one that looks chosen — and the
 * recipient can still change every value.
 */
export const THEMES: Theme[] = [
  {
    id: 'midnight',
    label: 'ليلي',
    note: 'خدمات تقنية، استشارات، أعمال تريد مظهرًا جادًا.',
    tokens: {
      ground: '#0B0D14',
      surface: 'rgba(255,255,255,0.04)',
      ink: '#E8EBF7',
      muted: '#9199B8',
      line: 'rgba(255,255,255,0.10)',
      brand: '#6366F1',
      brandInk: '#FFFFFF',
      accent: '#22D3EE',
    },
    fonts: { display: 'Readex Pro', body: 'IBM Plex Sans Arabic' },
    radius: '16px',
  },
  {
    id: 'sand',
    label: 'رملي',
    note: 'مطاعم، مقاهٍ، ضيافة، حرف يدوية.',
    tokens: {
      ground: '#FBF7F0',
      surface: '#FFFFFF',
      ink: '#221C14',
      muted: '#6B5D4B',
      line: 'rgba(34,28,20,0.12)',
      brand: '#A8551E',
      brandInk: '#FFFFFF',
      accent: '#1F6F5C',
    },
    fonts: { display: 'Tajawal', body: 'IBM Plex Sans Arabic' },
    radius: '14px',
  },
  {
    id: 'clinic',
    label: 'طبي',
    note: 'عيادات، مختبرات، صيدليات، رعاية.',
    tokens: {
      ground: '#F6FAFC',
      surface: '#FFFFFF',
      ink: '#0F2430',
      muted: '#5A7280',
      line: 'rgba(15,36,48,0.11)',
      brand: '#0E7C86',
      brandInk: '#FFFFFF',
      accent: '#2563EB',
    },
    fonts: { display: 'Readex Pro', body: 'IBM Plex Sans Arabic' },
    radius: '18px',
  },
  {
    id: 'workshop',
    label: 'ورشة',
    note: 'صيانة، مقاولات، نقل، خدمات ميدانية.',
    tokens: {
      ground: '#14161A',
      surface: 'rgba(255,255,255,0.05)',
      ink: '#F2F4F6',
      muted: '#98A0AC',
      line: 'rgba(255,255,255,0.12)',
      brand: '#F59E0B',
      brandInk: '#14161A',
      accent: '#EF4444',
    },
    fonts: { display: 'Tajawal', body: 'IBM Plex Sans Arabic' },
    radius: '10px',
  },
];

export const DEFAULT_THEME = THEMES[0].id;

export function findTheme(id?: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * The type scale, as a ratio rather than a fixed table.
 *
 * Sizes are emitted with `clamp()` so a generated page is responsive without
 * a single media query — the requirement was full mobile responsiveness, and
 * fluid type delivers it more reliably than breakpoints someone will later
 * edit and forget to keep in sync.
 */
export const TYPE_SCALE = {
  hero: 'clamp(2.1rem, 6vw, 4rem)',
  h2: 'clamp(1.5rem, 3.6vw, 2.3rem)',
  h3: 'clamp(1.05rem, 2.2vw, 1.3rem)',
  body: 'clamp(1rem, 1.6vw, 1.075rem)',
  small: '0.875rem',
  micro: '0.75rem',
} as const;

/** Spacing steps, so section rhythm is consistent rather than hand-picked. */
export const SPACE = {
  section: 'clamp(3.5rem, 9vw, 6.5rem)',
  gap: 'clamp(1rem, 2.5vw, 1.75rem)',
  pad: 'clamp(1.25rem, 3vw, 2rem)',
} as const;
