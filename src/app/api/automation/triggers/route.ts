import { NextResponse } from 'next/server';
import { LeadStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AGENT_TYPES } from '@/lib/ai/agent-defaults';
import { evaluateTrigger } from '@/lib/automation';
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
const createSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['lead_status']).default('lead_status'),
  leadStatus: z.nativeEnum(LeadStatus).optional(),
  agentType: z.enum(AGENT_TYPES as [string, ...string[]]),
  objectiveTemplate: z.string().min(5).max(2000),
  cooldownHours: z.number().int().min(1).max(24 * 30).default(24),
});

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

    const body = await parseBody(req, createSchema);

    const trigger = await prisma.automationTrigger.create({
      data: {
        userId: session.userId,
        name: body.name,
        kind: body.kind ?? 'lead_status',
        leadStatus: body.leadStatus ?? null,
        agentType: body.agentType,
        objectiveTemplate: body.objectiveTemplate,
        cooldownHours: body.cooldownHours ?? 24,
        enabled: false,
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
      select: { id: true },
    });

    if (!owned) {
      return NextResponse.json({ error: 'Trigger not found.' }, { status: 404 });
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
