import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MemorySystem, type MemoryType } from '@/lib/ai/memory';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

const MEMORY_TYPES = [
  'FACT',
  'PREFERENCE',
  'GOAL',
  'SKILL',
  'CONVERSATION',
] as const;

const storeMemorySchema = z.object({
  content: z.string().min(1).max(10_000),
  type: z.enum(MEMORY_TYPES),
  importance: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  tags: z.array(z.string().min(1).max(60)).max(25).default([]),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`memory:${session.userId}:${clientIp(req)}`);

    const body = await parseBody(req, storeMemorySchema);
    const memorySystem = new MemorySystem(session.userId);

    const memory = await memorySystem.store(body.content, body.type, body.importance, {
      tags: body.tags,
    });

    return NextResponse.json({ memory }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/memory');
  }
}

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`memory:${session.userId}:${clientIp(req)}`);

    const { searchParams } = new URL(req.url);

    const limit = Math.min(
      Math.max(Number.parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1),
      100,
    );

    const typeParam = searchParams.get('type');

    if (typeParam && !MEMORY_TYPES.includes(typeParam as MemoryType)) {
      return NextResponse.json(
        { error: `type must be one of: ${MEMORY_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    const memorySystem = new MemorySystem(session.userId);

    const memories = typeParam
      ? await memorySystem.getByType(typeParam as MemoryType, limit)
      : await memorySystem.getRecent(limit);

    return NextResponse.json({ memories });
  } catch (error) {
    return handleRouteError(error, 'GET /api/memory');
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`memory:${session.userId}:${clientIp(req)}`);

    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Memory id is required.' }, { status: 400 });
    }

    const deleted = await new MemorySystem(session.userId).delete(id);

    if (!deleted) {
      return NextResponse.json({ error: 'Memory not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/memory');
  }
}
