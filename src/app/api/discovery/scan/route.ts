import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimitShared,
  requireUser,
} from '@/lib/api/guard';
import { runDiscoveryScan } from '@/lib/discovery/scan';
import {
  DiscoveryProviderError,
  DiscoveryUnavailableError,
} from '@/lib/discovery/provider';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Business discovery.
 *
 * Every scan is a metered call to a paid external directory, so this shares
 * the Postgres-backed limiter with the other spend-bearing endpoints rather
 * than the in-process one: the budget has to hold across replicas.
 */
const scanSchema = z.object({
  query: z.string().min(2).max(200),
  location: z.string().min(2).max(200),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    await rateLimitShared(`discovery:${session.userId}:${clientIp(req)}`, 10);

    const body = await parseBody(req, scanSchema);

    const result = await runDiscoveryScan({
      userId: session.userId,
      actor: session.email,
      query: body.query,
      location: body.location,
      limit: body.limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    // 503, not 502: the instance is missing configuration, so retrying the
    // same request against it will not help. Matches the AI-provider path.
    if (error instanceof DiscoveryUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    // The provider answered and refused. Transient, so 502 and retry.
    if (error instanceof DiscoveryProviderError) {
      return NextResponse.json(
        { error: 'The discovery provider is currently unavailable. Please retry.' },
        { status: 502 },
      );
    }

    return handleRouteError(error, 'POST /api/discovery/scan');
  }
}
