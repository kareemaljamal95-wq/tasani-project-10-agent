import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { getSession, type SessionPayload } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { AIProviderError } from '@/lib/ai/provider';
import {
  RateLimitError,
  rateLimitLocal,
  rateLimitShared,
} from '@/lib/rate-limit';

export { RateLimitError, rateLimitShared };

/**
 * Shared guards for route handlers: authentication, input validation and rate
 * limiting. Every route uses these instead of trusting its own body parsing —
 * previously no route validated anything and all of them shared one hardcoded
 * tenant.
 */

/** Thrown by `requireUser`; converted to a 401 by `handleRouteError`. */
export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export async function requireUser(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/** Parses and validates a JSON body, or throws ValidationError. */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;

  try {
    raw = await req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    throw new ValidationError(
      'Request body failed validation.',
      result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    );
  }

  return result.data;
}

/**
 * In-process limiter, kept for read-heavy endpoints where a brief overshoot
 * across replicas costs nothing. Sensitive endpoints use `rateLimitShared`,
 * which counts in the database so the budget holds across instances.
 */
export function rateLimit(identifier: string, max?: number): void {
  rateLimitLocal(identifier, max);
}

/** Best-effort client identity for rate limiting behind a proxy. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Converts thrown errors into responses.
 *
 * Internal error messages are deliberately not echoed to the client — the
 * previous routes returned raw messages, which leaks schema and driver detail.
 */
export function handleRouteError(error: unknown, context: string): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof ValidationError) {
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status: 400 },
    );
  }

  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: 'Too many requests. Please retry shortly.' },
      { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
    );
  }

  if (error instanceof AIProviderError) {
    return NextResponse.json(
      { error: 'The AI provider is currently unavailable. Please retry.' },
      { status: 502 },
    );
  }

  logger.error(`Unhandled error in ${context}`, {
    error: error instanceof Error ? error.message : String(error),
  });

  return NextResponse.json(
    { error: 'An internal error occurred.' },
    { status: 500 },
  );
}
