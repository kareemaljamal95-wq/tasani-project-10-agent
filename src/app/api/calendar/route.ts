import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const userId = 'demo-user';
    const { searchParams } = new URL(req.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    const events = await prisma.calendarEvent.findMany({
      where: {
        userId,
        ...(start && end ? {
          startDate: { gte: new Date(start) },
          endDate: { lte: new Date(end) },
        } : {}),
      },
      orderBy: { startDate: 'asc' },
    });

    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { title, description, startDate, endDate, isAllDay, location, color } = await req.json();
    const userId = 'demo-user';

    const event = await prisma.calendarEvent.create({
      data: {
        title,
        description,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        isAllDay: isAllDay ?? false,
        location,
        color,
        userId,
      },
    });

    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
