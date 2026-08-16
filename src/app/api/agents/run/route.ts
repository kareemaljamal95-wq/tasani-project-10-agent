import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AGENT_TYPES } from '@/lib/ai/agent-defaults';
import { evaluatePolicy } from '@/lib/ai/policies';
import { runAgentDecision } from '@/lib/ai/decision';
import { createApproval } from '@/lib/approvals';
import { recordAudit } from '@/lib/audit';
import { hasAnyAIProvider } from '@/lib/env';
import { handleRouteError, parseBody, rateLimit, requireUser } from '@/lib/api/guard';

/**
 * Agent execution.
 *
 * The full chain: policy check → model decision → policy re-check against the
 * agent's own output → either an autonomous result or a PENDING approval.
 * This endpoint never sends anything; the most it produces is a proposal
 * queued for a human.
 */
const runSchema = z.object({
  agentId: z.enum(AGENT_TYPES as [string, ...string[]]),
  objective: z.string().min(5).max(4000),
  amountUsd: z.number().nonnegative().max(1_000_000).optional(),
  channel: z.string().max(60).optional(),
  recipient: z.string().email().max(320).optional(),
  context: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`agent-run:${session.userId}`, 20);

    if (!hasAnyAIProvider()) {
      return NextResponse.json(
        { error: 'No AI provider is configured.' },
        { status: 503 },
      );
    }

    const body = await parseBody(req, runSchema);
    const startedAt = Date.now();

    const policy = await evaluatePolicy({
      userId: session.userId,
      agentId: body.agentId,
      objective: body.objective,
      amountUsd: body.amountUsd,
    });

    if (policy.blocked) {
      await prisma.agentRun.create({
        data: {
          userId: session.userId,
          agentId: body.agentId,
          objective: body.objective,
          amountUsd: body.amountUsd ?? null,
          blocked: true,
          reason: policy.reason,
        },
      });

      await recordAudit({
        type: 'policy_blocked',
        message: policy.reason,
        data: { agentId: body.agentId, objective: body.objective },
        userId: session.userId,
        actor: session.email,
      });

      return NextResponse.json(
        { ok: false, status: 'blocked', reason: policy.reason },
        { status: 403 },
      );
    }

    const decision = await runAgentDecision({
      userId: session.userId,
      agentId: body.agentId,
      objective: body.objective,
      amountUsd: body.amountUsd,
      context: body.context ?? {},
      policy,
    });

    // The agent may escalate beyond what policy required, but it can never
    // de-escalate: an OR, not an assignment.
    const requiresApproval =
      decision.requiresHumanApproval || policy.requiresHumanApproval;

    await prisma.agentRun.create({
      data: {
        userId: session.userId,
        agentId: body.agentId,
        objective: body.objective,
        amountUsd: body.amountUsd ?? null,
        blocked: false,
        reason: policy.reason,
        riskLevel: decision.riskLevel,
        requiresHumanApproval: requiresApproval,
        latencyMs: Date.now() - startedAt,
        modelUsed: decision.modelUsed,
      },
    });

    await recordAudit({
      type: 'agent_run',
      message: `Agent ${body.agentId} produced a decision.`,
      data: { objective: body.objective, riskLevel: decision.riskLevel },
      userId: session.userId,
      actor: session.email,
    });

    if (requiresApproval) {
      const approval = await createApproval({
        userId: session.userId,
        agentId: body.agentId,
        objective: body.objective,
        amountUsd: body.amountUsd,
        decision,
        channel: body.channel,
        recipient: body.recipient,
      });

      return NextResponse.json(
        { ok: true, status: 'approval_required', policy, approval },
        { status: 202 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: 'autonomous',
      policy,
      decision,
    });
  } catch (error) {
    return handleRouteError(error, 'POST /api/agents/run');
  }
}
