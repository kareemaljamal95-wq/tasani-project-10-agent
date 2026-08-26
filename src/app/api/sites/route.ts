import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimit,
  rateLimitShared,
  requireUser,
} from '@/lib/api/guard';
import { buildSite, listSites, EmptySourceError, THEMES } from '@/lib/sitegen';

export const dynamic = 'force-dynamic';

/**
 * Site generation.
 *
 * Shares the spend-bearing rate limiter with the other endpoints that consume
 * a metered unit, so a burst here cannot exhaust an owner's monthly budget
 * faster than they can notice.
 */
const buildSchema = z.object({
  raw: z.string().min(2).max(20_000),
  name: z.string().min(1).max(300).optional(),
  leadId: z.string().min(1).max(60).optional(),
  themeId: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]).optional(),
});

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`sites:${session.userId}:${clientIp(req)}`);

    return NextResponse.json({ sites: await listSites(session.userId) });
  } catch (error) {
    return handleRouteError(error, 'GET /api/sites');
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    // Ten builds a minute: generous for real use, and slow enough that a
    // runaway client cannot burn the monthly budget before anyone notices.
    await rateLimitShared(`sites:build:${session.userId}:${clientIp(req)}`, 10);

    const body = await parseBody(req, buildSchema);

    const site = await buildSite({
      userId: session.userId,
      actor: session.email ?? session.userId,
      raw: body.raw,
      name: body.name,
      leadId: body.leadId,
      themeId: body.themeId,
    });

    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    // The paste yielded nothing usable. A client mistake, not a server fault,
    // and it happens before anything is metered.
    if (error instanceof EmptySourceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return handleRouteError(error, 'POST /api/sites');
  }
}
