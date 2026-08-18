import { NextResponse } from 'next/server';
import { LeadStatus } from '@prisma/client';
import { z } from 'zod';
import { createLead, DuplicateLeadError, listLeads } from '@/lib/leads';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimit,
  rateLimitShared,
  requireUser,
} from '@/lib/api/guard';

const createLeadSchema = z.object({
  companyName: z.string().min(1).max(300),
  contactName: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(60).optional(),
  website: z.string().url().max(500).optional(),
  source: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
  assignedAgent: z.string().max(60).optional(),
  score: z.number().int().min(0).max(100).optional(),
});

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`leads:${session.userId}:${clientIp(req)}`);

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');

    const parsed = z.nativeEnum(LeadStatus).optional().safeParse(
      statusParam ?? undefined,
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: `status must be one of: ${Object.values(LeadStatus).join(', ')}` },
        { status: 400 },
      );
    }

    const leads = await listLeads(session.userId, {
      status: parsed.data,
      limit: Number(searchParams.get('limit') ?? 50),
      cursor: searchParams.get('cursor') ?? undefined,
    });

    return NextResponse.json({
      leads,
      nextCursor: leads.length > 0 ? leads[leads.length - 1].id : null,
    });
  } catch (error) {
    return handleRouteError(error, 'GET /api/leads');
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();

    // Shared budget: lead creation is the surface an import loop or a scripted
    // abuse run would hammer, so it must hold across replicas.
    await rateLimitShared(`leads-write:${session.userId}`, 120);

    const body = await parseBody(req, createLeadSchema);

    const lead = await createLead({
      userId: session.userId,
      actor: session.email,
      ...body,
    });

    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateLeadError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return handleRouteError(error, 'POST /api/leads');
  }
}
