import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env, hasAnyAIProvider } from '@/lib/env';
import { isOutreachConfigured } from '@/lib/outreach';

export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness.
 *
 * Two things are load-bearing here:
 *
 *  - The database check is a real query, not a config read: an endpoint that
 *    returns 200 while the database is unreachable keeps a broken instance in
 *    the load-balancer pool.
 *
 *  - The environment is validated too. Configuration is parsed lazily on first
 *    use, so an instance missing AUTH_SECRET starts, serves a green health
 *    check, and then 500s every real request. A scheduled automation caller
 *    would retry against that instance indefinitely. Readiness now fails
 *    instead, which is what an orchestrator acts on.
 *
 * The failure is reported as a boolean and a fixed string; the validation
 * message names variables and is kept to the logs.
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    configuration: false,
    database: false,
    aiProvider: false,
    outreach: false,
  };

  try {
    env();
    checks.configuration = true;
  } catch {
    checks.configuration = false;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  try {
    checks.aiProvider = hasAnyAIProvider();
    checks.outreach = isOutreachConfigured();
  } catch {
    // isOutreachConfigured reads validated config; already covered above.
  }

  // A missing provider key or outbound transport is a deliberate default, not
  // a fault, so neither fails readiness. Broken configuration and an
  // unreachable database do.
  const ready = checks.configuration && checks.database;

  return NextResponse.json(
    {
      status: ready ? 'healthy' : 'unhealthy',
      service: 'Tasami OS',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
