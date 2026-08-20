import { LeadStatus, type Lead, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordActivity } from '@/lib/activity';
import { track } from '@/lib/analytics';

/**
 * Lead service.
 *
 * Every function takes the owning userId and scopes its query by it, so a
 * guessed or leaked lead id reads as not-found rather than as another
 * account's prospect.
 */

export class LeadNotFoundError extends Error {
  constructor() {
    super('Lead not found.');
    this.name = 'LeadNotFoundError';
  }
}

export class DuplicateLeadError extends Error {
  constructor() {
    super('This lead already exists in this account.');
    this.name = 'DuplicateLeadError';
  }
}

export interface CreateLeadInput {
  userId: string;
  actor: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  source?: string;
  notes?: string;
  assignedAgent?: string;
  score?: number;
  /** Set by an importer, e.g. 'google_places' and that source's own id. */
  externalSource?: string;
  externalId?: string;
}

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  try {
    const lead = await prisma.lead.create({
      data: {
        userId: input.userId,
        companyName: input.companyName,
        contactName: input.contactName ?? null,
        email: input.email?.trim().toLowerCase() ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
        source: input.source ?? 'manual',
        notes: input.notes ?? null,
        assignedAgent: input.assignedAgent ?? 'SALES',
        score: input.score ?? 0,
        externalSource: input.externalSource ?? null,
        externalId: input.externalId ?? null,
      },
    });

    await recordActivity({
      userId: input.userId,
      leadId: lead.id,
      type: 'lead_created',
      message: `أُضيف العميل المحتمل ${lead.companyName}.`,
      data: { source: lead.source },
      actor: input.actor,
    });

    track('lead_created', { userId: input.userId });

    return lead;
  } catch (error) {
    // Either unique constraint can raise this: (userId, email) for a manual or
    // emailed duplicate, (userId, externalSource, externalId) for a business a
    // discovery scan has already imported. Both mean the same thing to the
    // caller — this lead is already here — so both surface as DuplicateLead.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new DuplicateLeadError();
    }
    throw error;
  }
}

export async function listLeads(
  userId: string,
  options?: { status?: LeadStatus; limit?: number; cursor?: string },
) {
  return prisma.lead.findMany({
    where: { userId, ...(options?.status ? { status: options.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options?.limit ?? 50, 200),
    ...(options?.cursor
      ? { cursor: { id: options.cursor }, skip: 1 }
      : {}),
  });
}

export async function getLead(id: string, userId: string): Promise<Lead> {
  const lead = await prisma.lead.findFirst({ where: { id, userId } });
  if (!lead) throw new LeadNotFoundError();
  return lead;
}

export interface UpdateLeadInput {
  companyName?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  notes?: string | null;
  status?: LeadStatus;
  score?: number;
  assignedAgent?: string | null;
}

export async function updateLead(
  id: string,
  userId: string,
  updates: UpdateLeadInput,
  actor: string,
): Promise<Lead> {
  const current = await getLead(id, userId);

  const result = await prisma.lead.updateMany({
    where: { id, userId },
    data: updates,
  });

  if (result.count === 0) throw new LeadNotFoundError();

  const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });

  // A status change is the event automation and reporting care about, so it
  // gets its own activity type rather than being buried in a generic update.
  if (updates.status && updates.status !== current.status) {
    await recordActivity({
      userId,
      leadId: id,
      type: 'status_changed',
      message: `تغيّرت الحالة من ${current.status} إلى ${updates.status}.`,
      data: { from: current.status, to: updates.status },
      actor,
    });

    if (updates.status === LeadStatus.QUALIFIED) {
      track('qualified_lead', { userId });
    }
  } else {
    await recordActivity({
      userId,
      leadId: id,
      type: 'lead_updated',
      message: `تم تحديث بيانات ${lead.companyName}.`,
      data: { fields: Object.keys(updates) },
      actor,
    });
  }

  return lead;
}

export async function deleteLead(id: string, userId: string): Promise<boolean> {
  const result = await prisma.lead.deleteMany({ where: { id, userId } });
  return result.count > 0;
}

/** Marks the moment an approved message actually went out to this lead. */
export async function markLeadContacted(
  id: string,
  userId: string,
): Promise<void> {
  await prisma.lead.updateMany({
    where: { id, userId },
    data: {
      lastContactedAt: new Date(),
      // Only advance a lead that has not moved further on its own.
      ...(await shouldAdvanceToContacted(id, userId)
        ? { status: LeadStatus.CONTACTED }
        : {}),
    },
  });
}

async function shouldAdvanceToContacted(
  id: string,
  userId: string,
): Promise<boolean> {
  const lead = await prisma.lead.findFirst({
    where: { id, userId },
    select: { status: true },
  });

  return lead?.status === LeadStatus.NEW;
}
