import { prisma } from '@/lib/prisma';
import { evaluatePolicy } from '@/lib/ai/policies';
import { runAgentDecision } from '@/lib/ai/decision';
import { createApproval } from '@/lib/approvals';
import { recordAudit } from '@/lib/audit';
import { recordActivity } from '@/lib/activity';
import { track } from '@/lib/analytics';
import { hasAnyAIProvider } from '@/lib/env';
import { consumeAiAction } from '@/lib/billing/usage';

/**
 * The single agent execution path.
 *
 * Extracted from the API route so that automation runs through exactly the
 * same policy evaluation, approval gate and audit trail as a person clicking
 * "run". A second execution path would be a second place for the sovereignty
 * rules to drift out of sync, which is the one thing this product cannot
 * afford.
 */

export class ProviderUnavailableError extends Error {
  constructor() {
    super('No AI provider is configured.');
    this.name = 'ProviderUnavailableError';
  }
}

export type ExecutionResult =
  | { status: 'blocked'; reason: string }
  | { status: 'approval_required'; approvalId: string; policyReason: string; decision: unknown }
  | { status: 'autonomous'; decision: unknown };

export interface ExecuteAgentInput {
  userId: string;
  actor: string;
  agentId: string;
  objective: string;
  amountUsd?: number;
  channel?: string;
  recipient?: string;
  context?: Record<string, unknown>;
  leadId?: string;
  /** Set when the run originates from a queued job rather than a person. */
  jobId?: string;
}

export async function executeAgent(
  input: ExecuteAgentInput,
): Promise<ExecutionResult> {
  const startedAt = Date.now();

  // Policy first, deliberately. A forbidden objective must be refused whether
  // or not a model is reachable — ordering the provider check ahead of this
  // would turn a 403 into a 503 on an unconfigured install.
  const policy = await evaluatePolicy({
    userId: input.userId,
    agentId: input.agentId,
    objective: input.objective,
    amountUsd: input.amountUsd,
  });

  if (policy.blocked) {
    await prisma.agentRun.create({
      data: {
        userId: input.userId,
        agentId: input.agentId,
        objective: input.objective,
        amountUsd: input.amountUsd ?? null,
        blocked: true,
        reason: policy.reason,
        leadId: input.leadId ?? null,
        jobId: input.jobId ?? null,
      },
    });

    await recordAudit({
      type: 'policy_blocked',
      message: policy.reason,
      data: { agentId: input.agentId, objective: input.objective },
      userId: input.userId,
      actor: input.actor,
    });

    if (input.leadId) {
      await recordActivity({
        userId: input.userId,
        leadId: input.leadId,
        type: 'agent_run',
        message: `تم حظر إجراء ${input.agentId} بموجب السياسة.`,
        data: { reason: policy.reason },
        actor: input.actor,
      });
    }

    return { status: 'blocked', reason: policy.reason };
  }

  if (!hasAnyAIProvider()) throw new ProviderUnavailableError();

  // Metered here, after policy and before the model call. Deliberate ordering:
  // a policy-blocked run is never charged (the customer is not billed for the
  // system refusing), and the reservation is atomic so two concurrent runs at
  // the limit cannot both proceed. Raises EntitlementError or UsageLimitError,
  // which the callers surface as 402/429 rather than a generic failure.
  await consumeAiAction(input.userId);

  const decision = await runAgentDecision({
    userId: input.userId,
    agentId: input.agentId,
    objective: input.objective,
    amountUsd: input.amountUsd,
    context: input.context ?? {},
    policy,
  });

  // The agent may escalate beyond what policy required, never de-escalate.
  const requiresApproval =
    decision.requiresHumanApproval || policy.requiresHumanApproval;

  await prisma.agentRun.create({
    data: {
      userId: input.userId,
      agentId: input.agentId,
      objective: input.objective,
      amountUsd: input.amountUsd ?? null,
      blocked: false,
      reason: policy.reason,
      riskLevel: decision.riskLevel,
      requiresHumanApproval: requiresApproval,
      latencyMs: Date.now() - startedAt,
      modelUsed: decision.modelUsed,
      leadId: input.leadId ?? null,
      jobId: input.jobId ?? null,
    },
  });

  await recordAudit({
    type: 'agent_run',
    message: `Agent ${input.agentId} produced a decision.`,
    data: { objective: input.objective, riskLevel: decision.riskLevel },
    userId: input.userId,
    actor: input.actor,
  });

  if (requiresApproval) {
    const approval = await createApproval({
      userId: input.userId,
      agentId: input.agentId,
      objective: input.objective,
      amountUsd: input.amountUsd,
      decision,
      channel: input.channel,
      recipient: input.recipient,
      leadId: input.leadId,
    });

    track('outreach_generated', {
      userId: input.userId,
      agentId: input.agentId,
      approvalId: approval.id,
    });
    track('approval_requested', {
      userId: input.userId,
      agentId: input.agentId,
      approvalId: approval.id,
    });

    if (input.leadId) {
      await recordActivity({
        userId: input.userId,
        leadId: input.leadId,
        type: 'approval_created',
        message: `اقترح ${input.agentId} إجراءً بانتظار اعتمادك.`,
        data: { approvalId: approval.id },
        actor: input.actor,
      });
    }

    return {
      status: 'approval_required',
      approvalId: approval.id,
      policyReason: policy.reason,
      decision,
    };
  }

  if (input.leadId) {
    await recordActivity({
      userId: input.userId,
      leadId: input.leadId,
      type: 'agent_run',
      message: `نفّذ ${input.agentId} إجراءً ضمن الصلاحية الممنوحة.`,
      data: { riskLevel: decision.riskLevel },
      actor: input.actor,
    });
  }

  return { status: 'autonomous', decision };
}
