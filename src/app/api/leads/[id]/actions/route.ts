import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AGENT_TYPES } from '@/lib/ai/agent-defaults';
import { getLead, LeadNotFoundError } from '@/lib/leads';
import {
  executeAgent,
  ProviderUnavailableError,
} from '@/lib/agent-execution';
import {
  handleRouteError,
  parseBody,
  rateLimitShared,
  requireUser,
} from '@/lib/api/guard';

/**
 * Runs an agent against a lead.
 *
 * Reuses `executeAgent`, so a lead action is policy-checked, gated and audited
 * exactly like any other run — there is no lead-specific approval concept.
 * Ownership is confirmed by loading the lead through the scoped service first,
 * so a foreign lead id 404s before any agent work starts.
 */
const actionSchema = z.object({
  agentType: z.enum(AGENT_TYPES as [string, ...string[]]),
  objective: z.string().min(5).max(4000),
  amountUsd: z.number().nonnegative().max(1_000_000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;

    await rateLimitShared(`lead-action:${session.userId}`, 20);

    const lead = await getLead(id, session.userId);
    const body = await parseBody(req, actionSchema);

    const result = await executeAgent({
      userId: session.userId,
      actor: session.email,
      agentId: body.agentType,
      objective: body.objective,
      amountUsd: body.amountUsd,
      leadId: lead.id,
      recipient: lead.email ?? undefined,
      channel: lead.email ? 'email' : undefined,
      context: { leadStatus: lead.status, companyName: lead.companyName },
    });

    if (result.status === 'blocked') {
      return NextResponse.json(
        { ok: false, status: 'blocked', reason: result.reason },
        { status: 403 },
      );
    }

    if (result.status === 'approval_required') {
      return NextResponse.json(
        {
          ok: true,
          status: 'approval_required',
          approval: { id: result.approvalId, decision: result.decision },
        },
        { status: 202 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: 'autonomous',
      decision: result.decision,
    });
  } catch (error) {
    if (error instanceof LeadNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return handleRouteError(error, 'POST /api/leads/[id]/actions');
  }
}
