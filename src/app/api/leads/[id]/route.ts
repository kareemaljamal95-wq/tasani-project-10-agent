import { NextResponse } from 'next/server';
import { LeadStatus } from '@prisma/client';
import { z } from 'zod';
import {
  deleteLead,
  getLead,
  LeadNotFoundError,
  updateLead,
} from '@/lib/leads';
import { listLeadActivities } from '@/lib/activity';
import { prisma } from '@/lib/prisma';
import {
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

const updateLeadSchema = z.object({
  companyName: z.string().min(1).max(300).optional(),
  contactName: z.string().max(200).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  website: z.string().url().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  score: z.number().int().min(0).max(100).optional(),
  assignedAgent: z.string().max(60).nullable().optional(),
});

/** Lead detail with its timeline and the agent work recorded against it. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    rateLimit(`lead:${session.userId}`);

    const lead = await getLead(id, session.userId);

    const [activities, approvals, runs] = await Promise.all([
      listLeadActivities(id, session.userId),
      prisma.approval.findMany({
        where: { leadId: id, userId: session.userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      prisma.agentRun.findMany({
        where: { leadId: id, userId: session.userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ]);

    return NextResponse.json({ lead, activities, approvals, runs });
  } catch (error) {
    if (error instanceof LeadNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleRouteError(error, 'GET /api/leads/[id]');
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    rateLimit(`lead:${session.userId}`);

    const updates = await parseBody(req, updateLeadSchema);

    const lead = await updateLead(id, session.userId, updates, session.email);

    return NextResponse.json({ lead });
  } catch (error) {
    if (error instanceof LeadNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleRouteError(error, 'PATCH /api/leads/[id]');
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;
    rateLimit(`lead:${session.userId}`);

    const deleted = await deleteLead(id, session.userId);

    if (!deleted) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/leads/[id]');
  }
}
