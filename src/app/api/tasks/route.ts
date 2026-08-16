import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  dueDate: z.coerce.date().optional(),
});

/**
 * Updates are restricted to a known field set. Previously this route spread
 * the whole request body into `data`, which let a caller rewrite `userId` and
 * move a record into someone else's account.
 */
const updateTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`tasks:${session.userId}:${clientIp(req)}`);

    const tasks = await prisma.task.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    return handleRouteError(error, 'GET /api/tasks');
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`tasks:${session.userId}:${clientIp(req)}`);

    const body = await parseBody(req, createTaskSchema);

    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
        dueDate: body.dueDate ?? null,
        userId: session.userId,
      },
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/tasks');
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`tasks:${session.userId}:${clientIp(req)}`);

    const { id, ...updates } = await parseBody(req, updateTaskSchema);

    // Scoping the update by userId as well as id means a request for another
    // tenant's row matches nothing instead of succeeding.
    const result = await prisma.task.updateMany({
      where: { id, userId: session.userId },
      data: updates,
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    }

    const task = await prisma.task.findUnique({ where: { id } });
    return NextResponse.json({ task });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/tasks');
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`tasks:${session.userId}:${clientIp(req)}`);

    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Task id is required.' }, { status: 400 });
    }

    const result = await prisma.task.deleteMany({
      where: { id, userId: session.userId },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/tasks');
  }
}
