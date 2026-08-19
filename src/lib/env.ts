import { z } from 'zod';

/**
 * Environment contract, validated on first access.
 *
 * Fail-closed: a missing secret stops the process rather than silently
 * degrading into an unauthenticated or unpersisted mode.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required — users, approvals and audit logs are persisted.'),

  /**
   * Signing key for session JWTs. Rotating it invalidates every live session,
   * which is the intended emergency logout.
   */
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters. Generate with: openssl rand -hex 32'),

  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),

  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),

  /**
   * Credential for the unattended automation worker. Without it the scheduled
   * path is closed; only a signed-in session can drive automation.
   */
  WORKER_API_KEY: z.string().min(32).optional(),

  // --- Billing -------------------------------------------------------------
  // PAYPAL_CLIENT_SECRET must never reach the browser. It is read only in
  // src/lib/billing/providers/paypal.ts, which is server-only.
  PAYPAL_CLIENT_ID: z.string().min(1).optional(),
  PAYPAL_CLIENT_SECRET: z.string().min(1).optional(),
  PAYPAL_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  /** Required to verify webhooks; without it every webhook is rejected. */
  PAYPAL_WEBHOOK_ID: z.string().min(1).optional(),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  /**
   * Outbound delivery stays off until a transport is configured, so an
   * APPROVED item can never silently become SENT.
   */
  OUTREACH_TRANSPORT: z.enum(['none', 'smtp']).default('none'),
  SMTP_URL: z.string().optional(),
  OUTREACH_FROM: z.string().optional(),

  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Copy .env.example to .env and fill in the required values.',
    );
  }

  const value = parsed.data;

  if (value.OUTREACH_TRANSPORT === 'smtp' && !value.SMTP_URL) {
    throw new Error('OUTREACH_TRANSPORT=smtp requires SMTP_URL to be set.');
  }

  cached = value;
  return value;
}

/** True when a payment provider has usable credentials configured. */
export function hasBillingProvider(): boolean {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET,
  );
}

/**
 * True when at least one model provider is configured.
 *
 * Reads process.env directly rather than the validated cache. Provider
 * presence is the one setting that legitimately differs between a boot and a
 * later check (a key added by a platform secret rotation, or swapped in a
 * test), and reading through the cache would report a stale answer.
 */
export function hasAnyAIProvider(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.GEMINI_API_KEY,
  );
}
