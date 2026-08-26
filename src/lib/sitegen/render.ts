import { PLACEHOLDERS } from './placeholders';
import { SPACE, TYPE_SCALE, findTheme, type Theme } from './theme';
import { present, type BusinessProfile, type ProfileField } from './profile';

/**
 * A profile rendered as one self-contained HTML file.
 *
 * Self-contained is a requirement, not a convenience: the owner receives a
 * single file they can open, edit, email, or drop on any host. No build step,
 * no package manager, no framework — the only outbound request is the Google
 * Fonts stylesheet, and the page has a full fallback stack if it never loads.
 *
 * Responsiveness comes from fluid type and intrinsic grids rather than
 * breakpoints. Someone will edit this file by hand; a layout that adapts
 * without media queries survives that editing, while a set of breakpoints
 * quietly stops matching the content it was tuned for.
 */

/** HTML-escapes text so a business name with an ampersand cannot break markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A telephone URI keeps only what a dialler accepts. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function slot(field: ProfileField): string {
  const p = PLACEHOLDERS[field];
  return `
      <div class="slot">
        <span class="slot-label">${esc(p.label)}</span>
        <p>${esc(p.ask)}</p>
      </div>`;
}

function fontLink(theme: Theme): string {
  const families = [theme.fonts.display, theme.fonts.body]
    .map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

function tokens(theme: Theme): string {
  const t = theme.tokens;
  return `
    /* ---------------------------------------------------------------
       نظام التصميم — عدّل هذه القيم وحدها ليتغيّر الموقع كله.
       Design tokens. Change these values and the whole page follows;
       nothing below hard-codes a colour, a size or a radius.
       --------------------------------------------------------------- */
    --ground: ${t.ground};      /* خلفية الصفحة */
    --surface: ${t.surface};    /* خلفية البطاقات */
    --ink: ${t.ink};            /* لون النص الأساسي */
    --muted: ${t.muted};        /* النص الثانوي */
    --line: ${t.line};          /* الحدود والفواصل */
    --brand: ${t.brand};        /* لون العلامة — الأزرار والروابط */
    --brand-ink: ${t.brandInk}; /* النص فوق لون العلامة */
    --accent: ${t.accent};      /* لون ثانوي للتمييز */
    --radius: ${theme.radius};  /* استدارة الزوايا */

    /* مقاسات الخط: تتمدد مع عرض الشاشة تلقائيًا بلا استعلامات وسائط.
       Fluid type — the page is responsive without media queries. */
    --t-hero: ${TYPE_SCALE.hero};
    --t-h2: ${TYPE_SCALE.h2};
    --t-h3: ${TYPE_SCALE.h3};
    --t-body: ${TYPE_SCALE.body};
    --t-small: ${TYPE_SCALE.small};
    --t-micro: ${TYPE_SCALE.micro};

    --s-section: ${SPACE.section};
    --s-gap: ${SPACE.gap};
    --s-pad: ${SPACE.pad};

    --font-display: "${theme.fonts.display}", "Segoe UI", system-ui, sans-serif;
    --font-body: "${theme.fonts.body}", "Segoe UI", system-ui, sans-serif;`;
}

export interface RenderOptions {
  themeId?: string;
  /** Adds a discreet credit line. Off by default: it is the owner's site. */
  credit?: boolean;
}

export function renderSite(
  profile: BusinessProfile,
  options: RenderOptions = {},
): string {
  const theme = findTheme(options.themeId);
  const rtl = profile.locale === 'ar';
  const missing = new Set<ProfileField>(profile.missing);

  const contactRows = [
    present(profile.phone)
      ? `<a class="row" href="${esc(telHref(profile.phone))}"><span>الهاتف</span><strong>${esc(profile.phone)}</strong></a>`
      : '',
    present(profile.email)
      ? `<a class="row" href="mailto:${esc(profile.email)}"><span>البريد</span><strong>${esc(profile.email)}</strong></a>`
      : '',
    present(profile.address)
      ? `<div class="row"><span>العنوان</span><strong>${esc(profile.address)}</strong></div>`
      : '',
  ]
    .filter(Boolean)
    .join('\n        ');

  const services = profile.services.length
    ? `<ul class="cards">
        ${profile.services
          .map(
            (s) => `<li class="card">
          <h3>${esc(s.name)}</h3>
          ${s.price ? `<p class="price">${esc(s.price)}</p>` : ''}
          ${s.description ? `<p class="muted">${esc(s.description)}</p>` : ''}
        </li>`,
          )
          .join('\n        ')}
      </ul>${missing.has('prices') ? slot('prices') : ''}`
    : slot('services');

  const hours = profile.hours.length
    ? `<ul class="hours">
        ${profile.hours
          .map(
            (h) =>
              `<li><span>${esc(h.days)}</span><strong>${esc(h.hours)}</strong></li>`,
          )
          .join('\n        ')}
      </ul>`
    : slot('hours');

  const ratingLine =
    typeof profile.rating === 'number'
      ? `<p class="rating">${profile.rating.toFixed(1)}${
          profile.ratingCount ? ` · ${profile.ratingCount} تقييم` : ''
        }</p>`
      : '';

  return `<!doctype html>
<html lang="${profile.locale}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(profile.name)}</title>
${present(profile.about) ? `<meta name="description" content="${esc(profile.about.slice(0, 155))}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontLink(theme)}">
<style>
  :root {${tokens(theme)}
  }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--font-body);
    font-size: var(--t-body);
    line-height: 1.75;
    -webkit-font-smoothing: antialiased;
  }

  .wrap { width: min(1000px, 90vw); margin-inline: auto; }

  h1, h2, h3 { font-family: var(--font-display); line-height: 1.15; margin: 0; text-wrap: balance; }
  h1 { font-size: var(--t-hero); font-weight: 700; letter-spacing: -0.02em; }
  h2 { font-size: var(--t-h2); font-weight: 600; margin-bottom: var(--s-gap); }
  h3 { font-size: var(--t-h3); font-weight: 600; }
  p { margin: 0 0 1rem; }
  .muted { color: var(--muted); }

  header {
    padding: var(--s-section) 0 calc(var(--s-section) * 0.7);
    border-bottom: 1px solid var(--line);
  }
  header p.tagline { font-size: var(--t-h3); color: var(--muted); max-width: 46ch; margin-top: 1rem; }
  .rating { font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 600; margin: 0.75rem 0 0; }
  .kicker { font-size: var(--t-micro); letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.9rem; }

  .cta {
    display: inline-block; margin-top: 1.75rem;
    background: var(--brand); color: var(--brand-ink);
    font-family: var(--font-display); font-weight: 600;
    padding: 0.85rem 1.9rem; border-radius: var(--radius);
    text-decoration: none;
  }
  .cta:hover { filter: brightness(1.08); }

  section { padding: var(--s-section) 0; border-bottom: 1px solid var(--line); }

  /* شبكة تتكيّف مع العرض بلا استعلامات وسائط.
     Intrinsic grid: columns are decided by available width, not breakpoints. */
  .cards { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-gap);
           grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); }
  .card { background: var(--surface); border: 1px solid var(--line);
          border-radius: var(--radius); padding: var(--s-pad); }
  .price { font-family: var(--font-display); font-weight: 700; color: var(--brand);
           font-variant-numeric: tabular-nums; margin: 0.5rem 0 0; }

  .hours { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
  .hours li { display: flex; justify-content: space-between; gap: 1rem;
              border-bottom: 1px dashed var(--line); padding-bottom: 0.6rem; }

  .rows { display: grid; gap: 0.6rem; }
  .row { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline;
         background: var(--surface); border: 1px solid var(--line);
         border-radius: var(--radius); padding: 0.9rem var(--s-pad);
         color: inherit; text-decoration: none; }
  .row span { color: var(--muted); font-size: var(--t-small); }
  .row strong { font-family: var(--font-display); }
  a.row:hover { border-color: var(--brand); }

  /* خانة ناقصة: تظهر كطلب بيانات، لا كمحتوى.
     An unfilled slot. Deliberately unmistakable — this platform never invents
     a price or an opening time, so the gap is shown as a gap. */
  .slot { border: 1px dashed var(--line); border-radius: var(--radius);
          padding: var(--s-pad); margin-top: var(--s-gap); background: transparent; }
  .slot-label { display: inline-block; font-size: var(--t-micro); letter-spacing: 0.14em;
                text-transform: uppercase; color: var(--brand); margin-bottom: 0.4rem; }
  .slot p { margin: 0; color: var(--muted); font-size: var(--t-small); }

  footer { padding: calc(var(--s-section) * 0.6) 0; color: var(--muted); font-size: var(--t-small); }

  a { color: var(--brand); }
  a:focus-visible, .cta:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
</head>
<body>

<header class="wrap">
  ${profile.category ? `<p class="kicker">${esc(profile.category)}</p>` : ''}
  <h1>${esc(profile.name)}</h1>
  ${
    present(profile.tagline)
      ? `<p class="tagline">${esc(profile.tagline)}</p>`
      : slot('tagline')
  }
  ${ratingLine}
  ${
    present(profile.phone)
      ? `<a class="cta" href="${esc(telHref(profile.phone))}">اتصل بنا</a>`
      : ''
  }
</header>

<section class="wrap">
  <h2>من نحن</h2>
  ${present(profile.about) ? `<p class="muted">${esc(profile.about)}</p>` : slot('about')}
</section>

<section class="wrap">
  <h2>خدماتنا</h2>
  ${services}
</section>

<section class="wrap">
  <h2>ساعات العمل</h2>
  ${hours}
</section>

<section class="wrap">
  <h2>تواصل معنا</h2>
  <div class="rows">
    ${contactRows}
  </div>
  ${missing.has('phone') ? slot('phone') : ''}
  ${missing.has('email') ? slot('email') : ''}
  ${missing.has('address') ? slot('address') : ''}
</section>

<footer class="wrap">
  <p>© ${new Date().getFullYear()} ${esc(profile.name)}</p>
  ${options.credit ? '<p>صُنع بواسطة تسامي</p>' : ''}
</footer>

</body>
</html>`;
}
