import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hasAnyAIProvider } from '@/lib/env';
import { isOutreachConfigured } from '@/lib/outreach';

export const dynamic = 'force-dynamic';

/**
 * Liveness and readiness.
 *
 * The database check is a real query, not a config read: a health endpoint
 * that returns 200 while the database is unreachable is worse than none, since
 * it keeps a broken instance in the load-balancer pool.
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    database: false,
    aiProvider: false,
    outreach: false,
  };

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
    // env() throws when configuration is invalid; reported as not-ready below.
  }

  // Outreach being unconfigured is a deliberate default, not a fault, so it
  // does not fail readiness.
  const ready = checks.database;

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
