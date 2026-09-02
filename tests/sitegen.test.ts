import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTestUser, giveTestSubscription, resetDatabase } from './helpers';
import {
  parseBusiness,
  renderSite,
  buildSite,
  shareSite,
  unshareSite,
  getSharedSite,
  EmptySourceError,
  THEMES,
  findTheme,
  blockingGaps,
} from '@/lib/sitegen';

/**
 * Site generation.
 *
 * The load-bearing assertions here are the negative ones. Anyone can check
 * that a parser reads a phone number; what protects the product is proving
 * that a page built from incomplete input contains no price, no opening hour
 * and no service the source never stated.
 */

const MAPS_PASTE = `مطعم الواحة الذهبية
4.6 ★ (312)
مطعم شرق أوسطي
شارع التحلية، حي العليا، الرياض
+966 11 456 7890
info@alwaha.example
الأحد - الخميس 12:00 - 23:00
الجمعة 16:00 - 23:00
- مندي لحم 85 ر.س
- كبسة دجاج 65 ر.س
- سلطة موسم
www.alwaha.example`;

/** What a real listing usually looks like: a name, a category, and little else. */
const SPARSE_PASTE = `ورشة النخبة لصيانة السيارات
ورشة سيارات
الدمام`;

describe('parsing a pasted listing', () => {
  it('reads the fields the source actually stated', () => {
    const p = parseBusiness({ raw: MAPS_PASTE });

    expect(p.name).toBe('مطعم الواحة الذهبية');
    expect(p.rating).toBe(4.6);
    expect(p.ratingCount).toBe(312);
    expect(p.phone).toContain('966');
    expect(p.email).toBe('info@alwaha.example');
    expect(p.address).toContain('التحلية');
    expect(p.locale).toBe('ar');
  });

  it('attaches a price only to the service it was written beside', () => {
    const p = parseBusiness({ raw: MAPS_PASTE });

    const mandi = p.services.find((s) => s.name.includes('مندي'));
    const salad = p.services.find((s) => s.name.includes('سلطة'));

    expect(mandi?.price).toContain('85');
    // The salad line carried no price, so it gets none — a price from another
    // line belongs to something unknown, and guessing is the invention this
    // parser exists to refuse.
    expect(salad).toBeDefined();
    expect(salad?.price).toBeUndefined();
  });

  it('reads each hours line separately rather than inventing a week', () => {
    const p = parseBusiness({ raw: MAPS_PASTE });

    expect(p.hours).toHaveLength(2);
    expect(p.hours[0].hours).toBe('12:00 - 23:00');
    expect(p.hours[1].days).toContain('الجمعة');
  });

  it('records what a sparse listing did not say', () => {
    const p = parseBusiness({ raw: SPARSE_PASTE });

    expect(p.name).toBe('ورشة النخبة لصيانة السيارات');
    expect(p.services).toHaveLength(0);
    expect(p.hours).toHaveLength(0);
    expect(p.phone).toBeUndefined();

    for (const gap of ['services', 'prices', 'hours', 'phone', 'about'] as const) {
      expect(p.missing).toContain(gap);
    }
  });

  it('does not turn a rating line into a service', () => {
    // Found on a real generated page: "4.3 ★ (87)" was read as list item "4."
    // followed by the service "3 ★ (87)". The rating parsed correctly at the
    // same time, so the page showed a right rating and an invented service —
    // the exact failure this parser exists to prevent, on a file a customer
    // would have been handed.
    const p = parseBusiness({
      raw: 'ورشة النخبة\n4.3 ★ (87)\nورشة سيارات\n- تغيير زيت 120 ر.س',
    });

    expect(p.rating).toBe(4.3);
    expect(p.ratingCount).toBe(87);
    expect(p.services).toHaveLength(1);
    expect(p.services[0].name).toBe('تغيير زيت');
  });

  it('still reads a genuine numbered list', () => {
    const p = parseBusiness({ raw: 'ورشة\nورشة سيارات\n1. تغيير زيت\n2) فحص شامل' });

    expect(p.services.map((s) => s.name)).toEqual(['تغيير زيت', 'فحص شامل']);
  });

  it('refuses empty input instead of producing an empty site', () => {
    expect(() => parseBusiness({ raw: '   \n  \n' })).toThrow(EmptySourceError);
  });

  it('detects language from the text rather than assuming', () => {
    expect(parseBusiness({ raw: 'Elite Auto Care\nGarage\nDammam' }).locale).toBe('en');
  });

  it('names blocking gaps separately from cosmetic ones', () => {
    const p = parseBusiness({ raw: SPARSE_PASTE });
    const blocking = blockingGaps(p.missing);

    // No phone and no services means the page cannot do its job; a missing
    // tagline only makes it thinner.
    expect(blocking).toContain('phone');
    expect(blocking).toContain('services');
    expect(blocking).not.toContain('tagline');
  });
});

describe('rendering', () => {
  it('invents no price, hour or service for a sparse listing', () => {
    const html = renderSite(parseBusiness({ raw: SPARSE_PASTE }));

    // The strongest guarantee this platform makes, asserted directly: no
    // currency, no clock time, and no digit pretending to be a rating.
    expect(html).not.toMatch(/ر\.?س|ريال|SAR|\$\s*\d/u);
    expect(html).not.toMatch(/\d{1,2}:\d{2}/u);
    expect(html).not.toMatch(/\d\.\d\s*·/u);
  });

  it('shows each gap as a request for data', () => {
    const html = renderSite(parseBusiness({ raw: SPARSE_PASTE }));

    expect(html).toContain('slot');
    expect(html).toContain('أضف خدماتك');
    expect(html).toContain('أضف أيام وساعات العمل');
  });

  it('carries stated values through unchanged', () => {
    const html = renderSite(parseBusiness({ raw: MAPS_PASTE }));

    expect(html).toContain('مطعم الواحة الذهبية');
    expect(html).toContain('85');
    expect(html).toContain('12:00 - 23:00');
    expect(html).toContain('4.6');
  });

  it('produces one self-contained file with no build step', () => {
    const html = renderSite(parseBusiness({ raw: MAPS_PASTE }));

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    // Fonts are the single permitted outbound request; nothing else is fetched.
    const externals = html.match(/https?:\/\/[^"')\s]+/g) ?? [];
    for (const url of externals) {
      expect(url).toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });

  it('carries its own favicon so no visitor gets a 404', () => {
    const html = renderSite(parseBusiness({ raw: MAPS_PASTE }));

    // Inlined rather than linked: without it every browser falls back to
    // requesting /favicon.ico from whatever host serves the page, and a site
    // delivered to a paying customer should not log a 404 on every visit.
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
    // And it must not become a second file the owner has to remember to send.
    expect(html).not.toMatch(/rel="icon" href="\/?favicon/);
  });

  it('escapes a name that would otherwise break the markup', () => {
    const html = renderSite(parseBusiness({ raw: 'Smith & Sons <Auto>\nGarage' }));

    expect(html).toContain('Smith &amp; Sons &lt;Auto&gt;');
    expect(html).not.toContain('<Auto>');
  });

  it('sets direction from the profile locale', () => {
    expect(renderSite(parseBusiness({ raw: MAPS_PASTE }))).toContain('dir="rtl"');
    expect(renderSite(parseBusiness({ raw: 'Elite Auto\nGarage' }))).toContain('dir="ltr"');
  });

  it('is responsive without a single media query for layout', () => {
    const html = renderSite(parseBusiness({ raw: MAPS_PASTE }));

    // Fluid type and intrinsic grids, so hand-editing the file cannot leave a
    // breakpoint tuned for content that has since changed.
    expect(html).toContain('clamp(');
    expect(html).toContain('auto-fit');
    const layoutQueries = (html.match(/@media[^{]+\{/g) ?? []).filter(
      (q) => !q.includes('prefers-reduced-motion'),
    );
    expect(layoutQueries).toHaveLength(0);
  });

  it('documents its own design tokens for whoever receives the file', () => {
    const html = renderSite(parseBusiness({ raw: MAPS_PASTE }));

    expect(html).toContain('--brand:');
    expect(html).toContain('عدّل هذه القيم');
  });
});

describe('themes', () => {
  it('falls back to a real theme for an unknown id', () => {
    expect(findTheme('nonexistent').id).toBe(THEMES[0].id);
  });

  it('gives every theme a complete token set', () => {
    for (const theme of THEMES) {
      for (const value of Object.values(theme.tokens)) {
        expect(value).toBeTruthy();
      }
      expect(theme.fonts.display).toBeTruthy();
      expect(theme.fonts.body).toBeTruthy();
    }
  });

  it('renders every theme without losing content', () => {
    const profile = parseBusiness({ raw: MAPS_PASTE });

    for (const theme of THEMES) {
      const html = renderSite(profile, { themeId: theme.id });
      expect(html).toContain('مطعم الواحة الذهبية');
      expect(html).toContain(theme.tokens.brand);
    }
  });
});


/**
 * Share links.
 *
 * A generated page only becomes a deliverable when the business owner can open
 * it — they have no account here, so the token *is* the access control. These
 * assertions are about that token: that it is unguessable, that revoking it
 * actually revokes, and that it never becomes a way into another account.
 */
describe('sharing a site', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function ownerWithSite() {
    const user = await createTestUser();
    await giveTestSubscription(user.id);
    const site = await buildSite({
      userId: user.id,
      actor: user.email,
      raw: MAPS_PASTE,
    });
    return { user, site };
  }

  it('serves the page to a holder of the link', async () => {
    const { user, site } = await ownerWithSite();

    const shared = await shareSite(site.id, user.id);
    expect(shared?.alreadyShared).toBe(false);

    // No user id anywhere in this call — that is the point.
    const page = await getSharedSite(shared!.token);
    expect(page?.html).toContain('مطعم الواحة الذهبية');
  });

  it('returns the same token rather than breaking a link already sent', async () => {
    const { user, site } = await ownerWithSite();

    const first = await shareSite(site.id, user.id);
    const second = await shareSite(site.id, user.id);

    expect(second?.token).toBe(first?.token);
    expect(second?.alreadyShared).toBe(true);
  });

  it('stops serving the page once the link is withdrawn', async () => {
    const { user, site } = await ownerWithSite();
    const shared = await shareSite(site.id, user.id);

    expect(await unshareSite(site.id, user.id)).toBe(true);

    // The whole promise of revocation. A stale link must read as if it never
    // existed, not merely as forbidden.
    expect(await getSharedSite(shared!.token)).toBeNull();
  });

  it('does not let a stranger share a site they do not own', async () => {
    const { site } = await ownerWithSite();
    const stranger = await createTestUser();

    expect(await shareSite(site.id, stranger.id)).toBeNull();
    expect(await unshareSite(site.id, stranger.id)).toBe(false);
  });

  it('treats an empty or unknown token as not found', async () => {
    await ownerWithSite();

    expect(await getSharedSite('')).toBeNull();
    expect(await getSharedSite('not-a-real-token')).toBeNull();
  });

  it('issues a token long enough not to be guessed', async () => {
    const { user, site } = await ownerWithSite();
    const shared = await shareSite(site.id, user.id);

    // 24 random bytes in base64url. The token is the only credential guarding
    // the page, so its length is a security property, not a detail.
    expect(shared!.token.length).toBeGreaterThanOrEqual(32);
    expect(shared!.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('remembers that a page was once public after revoking', async () => {
    const { user, site } = await ownerWithSite();
    await shareSite(site.id, user.id);
    await unshareSite(site.id, user.id);

    const row = await prisma.generatedSite.findUnique({ where: { id: site.id } });
    expect(row?.shareToken).toBeNull();
    expect(row?.sharedAt).toBeTruthy();
  });
});
