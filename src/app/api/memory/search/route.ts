import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MemorySystem } from '@/lib/ai/memory';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  type: z
    .enum(['FACT', 'PREFERENCE', 'GOAL', 'SKILL', 'CONVERSATION'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`memory-search:${session.userId}:${clientIp(req)}`);

    const body = await parseBody(req, searchSchema);
    const memorySystem = new MemorySystem(session.userId);

    // userId is not taken from the body — MemorySystem scopes every query to
    // the session's tenant, so a caller cannot search another account.
    const results = await memorySystem.search({
      query: body.query,
      types: body.type ? [body.type] : undefined,
      limit: body.limit,
    });

    return NextResponse.json({ results });
  } catch (error) {
    return handleRouteError(error, 'POST /api/memory/search');
  }
}
