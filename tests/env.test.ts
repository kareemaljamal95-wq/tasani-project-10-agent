import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Blank environment variables.
 *
 * The regression these guard: `NEXT_PUBLIC_APP_URL` was present in the Vercel
 * production environment with an empty value. `??` and Zod's `.default()` both
 * only fall back on `undefined`, so `''` travelled all the way into
 * `new URL('')` in the root layout and failed the production build — and would
 * have failed checkout and password reset too, since both build absolute URLs
 * from the same value.
 *
 * Modules are re-imported per test because `env()` memoises its result and
 * `site.ts` reads `process.env` once at module scope.
 */
const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('blank environment variables', () => {
  it('falls back to the default when NEXT_PUBLIC_APP_URL is empty', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '';

    const { env } = await import('@/lib/env');

    expect(env().NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
  });

  it('treats whitespace as empty', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '   ';

    const { env } = await import('@/lib/env');

    expect(env().NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
  });

  it('yields a URL the root layout can construct', async () => {
    // This is the build failure in unit form: new URL('') throws ERR_INVALID_URL
    // at module scope in src/app/layout.tsx, during prerender of every page.
    process.env.NEXT_PUBLIC_APP_URL = '';

    const { SITE } = await import('@/lib/site');

    expect(() => new URL(SITE.url)).not.toThrow();
    expect(new URL(SITE.url).origin).toBe('http://localhost:3000');
  });

  it('still rejects a blank AUTH_SECRET rather than inventing one', async () => {
    // Degrading to a default is right for a public URL and catastrophic for a
    // signing key. Dropping blanks must not turn a required secret optional.
    process.env.AUTH_SECRET = '';

    const { env } = await import('@/lib/env');

    expect(() => env()).toThrow(/AUTH_SECRET/);
  });

  it('lets the override win over a webhook id the operator cannot edit', async () => {
    // The situation it was added for: the platform pins PAYPAL_WEBHOOK_ID at a
    // level the operator has no write access to, so the stale value cannot be
    // removed. Every call site must see the override, not the pinned value.
    process.env.PAYPAL_WEBHOOK_ID = 'stale-id-from-the-service';
    process.env.PAYPAL_WEBHOOK_ID_OVERRIDE = 'the-live-webhook-id';

    const { env } = await import('@/lib/env');

    expect(env().PAYPAL_WEBHOOK_ID).toBe('the-live-webhook-id');
  });

  it('keeps the plain webhook id when no override is set', async () => {
    process.env.PAYPAL_WEBHOOK_ID = 'the-only-id';
    delete process.env.PAYPAL_WEBHOOK_ID_OVERRIDE;

    const { env } = await import('@/lib/env');

    expect(env().PAYPAL_WEBHOOK_ID).toBe('the-only-id');
  });

  it('ignores a blank override rather than blanking the real id', async () => {
    // A variable added in a dashboard and left empty must not erase the
    // working value — the failure mode this file exists for.
    process.env.PAYPAL_WEBHOOK_ID = 'the-real-id';
    process.env.PAYPAL_WEBHOOK_ID_OVERRIDE = '   ';

    const { env } = await import('@/lib/env');

    expect(env().PAYPAL_WEBHOOK_ID).toBe('the-real-id');
  });

  it('reads a blank provider secret as absent, not as configured', async () => {
    process.env.PAYPAL_CLIENT_ID = 'id';
    process.env.PAYPAL_CLIENT_SECRET = '';

    const { hasBillingProvider } = await import('@/lib/env');

    expect(hasBillingProvider()).toBe(false);
  });
});
