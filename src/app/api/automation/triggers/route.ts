import { NextResponse } from 'next/server';
import { LeadStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  createTriggerSchema,
  evaluateTrigger,
  parseDiscoverySearch,
} from '@/lib/automation';
import {
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';
import { requireWithinLimit } from '@/lib/billing/entitlements';

/**
 * Automation triggers.
 *
 * A trigger enqueues jobs; it never executes anything itself. Everything it
 * queues runs through the same policy and approval pipeline as a manual run,
 * so enabling a trigger cannot widen what an agent is allowed to do.
 *
 * New triggers are created disabled: automation should be an explicit act.
 */
const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  leadStatus: z.nativeEnum(LeadStatus).nullable().optional(),
  objectiveTemplate: z.string().min(5).max(2000).optional(),
  cooldownHours: z.number().int().min(1).max(24 * 30).optional(),
  /** Evaluate immediately, queueing work for whatever matches right now. */
  runNow: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await requireUser();
    rateLimit(`triggers:${session.userId}`);

    const triggers = await prisma.automationTrigger.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ triggers });
  } catch (error) {
    return handleRouteError(error, 'GET /api/automation/triggers');
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`triggers-write:${session.userId}`, 30);

    const body = await parseBody(req, createTriggerSchema);

    const trigger = await prisma.automationTrigger.create({
      data: {
        userId: session.userId,
        name: body.name,
        kind: body.kind,
        cooldownHours: body.cooldownHours,
        enabled: false,
        ...(body.kind === 'discovery'
          ? {
              // The search rides in objectiveTemplate, which is what
              // evaluateDiscoveryTrigger reads. agentType is a required column
              // that this kind never consults — no agent runs, a scan does.
              objectiveTemplate: body.search,
              agentType: 'discovery',
              leadStatus: null,
            }
          : {
              objectiveTemplate: body.objectiveTemplate,
              agentType: body.agentType,
              leadStatus: body.leadStatus ?? null,
            }),
      },
    });

    return NextResponse.json({ trigger }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'POST /api/automation/triggers');
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`triggers-write:${session.userId}`, 30);

    const { id, runNow, ...updates } = await parseBody(req, updateSchema);

    // Ownership is established with an explicit scoped read rather than by
    // reading updateMany's count: a request carrying only `runNow` has no
    // fields to write, and updateMany reports zero rows changed for an empty
    // data object — which would report a trigger the user owns as missing.
    const owned = await prisma.automationTrigger.findFirst({
      where: { id, userId: session.userId },
      select: { id: true, kind: true },
    });

    if (!owned) {
      return NextResponse.json({ error: 'Trigger not found.' }, { status: 404 });
    }

    // On a discovery trigger the objective *is* the search, so an edit has to
    // clear the same bar creation does. Otherwise a valid trigger could be
    // edited into one that runs every cycle and silently produces nothing.
    if (
      owned.kind === 'discovery' &&
      updates.objectiveTemplate !== undefined &&
      parseDiscoverySearch(updates.objectiveTemplate) === null
    ) {
      return NextResponse.json(
        { error: 'اكتب البحث بالصيغة: استعلام @ مدينة' },
        { status: 400 },
      );
    }

    // Enabling an automation consumes a paid slot. Other enabled triggers are
    // counted, so re-enabling one already on is not blocked by itself.
    if (updates.enabled === true) {
      const enabled = await prisma.automationTrigger.count({
        where: { userId: session.userId, enabled: true, NOT: { id } },
      });

      await requireWithinLimit(session.userId, 'automations.max', enabled);
    }

    if (Object.keys(updates).length > 0) {
      await prisma.automationTrigger.updateMany({
        where: { id, userId: session.userId },
        data: updates,
      });
    }

    const evaluation = runNow ? await evaluateTrigger(id) : null;

    const trigger = await prisma.automationTrigger.findUnique({ where: { id } });

    return NextResponse.json({ trigger, evaluation });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/automation/triggers');
  }
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function DELETE(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`triggers-write:${session.userId}`, 30);

    const { id } = await parseBody(req, deleteSchema);

    // Scoped by userId so a guessed id reads as not-found rather than deleting
    // another account's automation. Queued Job rows keep their history; the
    // schema nulls their triggerId rather than cascading, so an execution
    // record survives the automation that produced it.
    const removed = await prisma.automationTrigger.deleteMany({
      where: { id, userId: session.userId },
    });

    if (removed.count === 0) {
      return NextResponse.json({ error: 'Trigger not found.' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/automation/triggers');
  }
}
