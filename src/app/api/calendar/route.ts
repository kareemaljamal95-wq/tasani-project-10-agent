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

const createEventSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    isAllDay: z.boolean().default(false),
    location: z.string().max(500).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a hex value such as #3b82f6')
      .optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate.',
    path: ['endDate'],
  });

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`calendar:${session.userId}:${clientIp(req)}`);

    const { searchParams } = new URL(req.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    const range = z.coerce.date();
    const parsedStart = start ? range.safeParse(start) : null;
    const parsedEnd = end ? range.safeParse(end) : null;

    if ((start && !parsedStart?.success) || (end && !parsedEnd?.success)) {
      return NextResponse.json(
        { error: 'start and end must be valid dates.' },
        { status: 400 },
      );
    }

    const events = await prisma.calendarEvent.findMany({
      where: {
        userId: session.userId,
        ...(parsedStart?.success && parsedEnd?.success
          ? {
              startDate: { gte: parsedStart.data },
              endDate: { lte: parsedEnd.data },
            }
          : {}),
      },
      orderBy: { startDate: 'asc' },
      take: 500,
    });

    return NextResponse.json({ events });
  } catch (error) {
    return handleRouteError(error, 'GET /api/calendar');
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`calendar:${session.userId}:${clientIp(req)}`);

    const body = await parseBody(req, createEventSchema);

    const event = await prisma.calendarEvent.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        isAllDay: body.isAllDay,
        location: body.location ?? null,
        color: body.color ?? null,
        userId: session.userId,
      },
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/calendar');
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`calendar:${session.userId}:${clientIp(req)}`);

    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Event id is required.' }, { status: 400 });
    }

    const result = await prisma.calendarEvent.deleteMany({
      where: { id, userId: session.userId },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/calendar');
  }
}
