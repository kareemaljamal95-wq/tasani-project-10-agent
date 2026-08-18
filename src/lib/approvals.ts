import { ApprovalStatus, type Approval, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/lib/audit';
import { dispatchOutbound } from '@/lib/outreach';

/**
 * Approval lifecycle — the human-sovereignty gate.
 *
 * Nothing reaches the outside world without passing through here. An agent can
 * create a PENDING item and nothing more; only a human transition produces
 * APPROVED, and only `dispatchApproval` can produce SENT.
 *
 *   PENDING  → APPROVED | EDITED | REJECTED
 *   EDITED   → APPROVED | REJECTED
 *   APPROVED → SENT | FAILED
 *   FAILED   → APPROVED            (operator retry)
 *   SENT, REJECTED                 (terminal)
 */
const TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  PENDING: ['APPROVED', 'EDITED', 'REJECTED'],
  EDITED: ['APPROVED', 'REJECTED'],
  APPROVED: ['SENT', 'FAILED'],
  FAILED: ['APPROVED'],
  SENT: [],
  REJECTED: [],
};

export class ApprovalStateError extends Error {
  constructor(
    readonly from: ApprovalStatus,
    readonly to: ApprovalStatus,
  ) {
    super(`Illegal approval transition: ${from} → ${to}.`);
    this.name = 'ApprovalStateError';
  }
}

export class ApprovalNotFoundError extends Error {
  constructor() {
    super('Approval not found.');
    this.name = 'ApprovalNotFoundError';
  }
}

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

function assertTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  if (!canTransition(from, to)) throw new ApprovalStateError(from, to);
}

export interface AgentDecision {
  decision: string;
  recommendedAction: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  requiresHumanApproval: boolean;
  rationaleSummary: string;
  expectedBusinessImpact: string;
  suggestedNextStep: string;
}

export interface CreateApprovalInput {
  userId: string;
  agentId: string;
  objective: string;
  amountUsd?: number;
  decision: AgentDecision;
  channel?: string;
  recipient?: string;
  leadId?: string;
}

export async function createApproval(input: CreateApprovalInput): Promise<Approval> {
  const approval = await prisma.approval.create({
    data: {
      userId: input.userId,
      agentId: input.agentId,
      objective: input.objective,
      amountUsd: input.amountUsd ?? null,
      decision: input.decision as unknown as Prisma.InputJsonValue,
      channel: input.channel ?? null,
      recipient: input.recipient ?? null,
      leadId: input.leadId ?? null,
      status: ApprovalStatus.PENDING,
    },
  });

  await recordAudit({
    type: 'approval_created',
    message: `Approval required for ${input.agentId}.`,
    data: { objective: input.objective, amountUsd: input.amountUsd },
    userId: input.userId,
    approvalId: approval.id,
  });

  return approval;
}

export async function listApprovals(
  userId: string,
  options?: { status?: ApprovalStatus; limit?: number },
): Promise<Approval[]> {
  return prisma.approval.findMany({
    where: { userId, ...(options?.status ? { status: options.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options?.limit ?? 100, 500),
  });
}

/** Always scoped by userId: an id from another tenant reads as not-found. */
async function getOwnedApproval(id: string, userId: string): Promise<Approval> {
  const approval = await prisma.approval.findFirst({ where: { id, userId } });
  if (!approval) throw new ApprovalNotFoundError();
  return approval;
}

export async function getApproval(id: string, userId: string): Promise<Approval> {
  return getOwnedApproval(id, userId);
}

/**
 * Records a human rewrite of the outbound content. The agent's original
 * proposal stays in `decision`, so the difference between what was suggested
 * and what a human actually sent remains auditable.
 */
export async function editApproval(
  id: string,
  userId: string,
  editedAction: string,
  actor: string,
): Promise<Approval> {
  const current = await getOwnedApproval(id, userId);
  assertTransition(current.status, ApprovalStatus.EDITED);

  const updated = await prisma.approval.update({
    where: { id },
    data: {
      status: ApprovalStatus.EDITED,
      editedAction,
      decidedBy: actor,
      decidedAt: new Date(),
    },
  });

  await recordAudit({
    type: 'approval_edited',
    message: `Approval ${id} was edited before approval.`,
    data: {
      originalAction: (current.decision as { recommendedAction?: string })
        ?.recommendedAction,
      editedAction,
    },
    userId,
    actor,
    approvalId: id,
  });

  return updated;
}

export async function approveApproval(
  id: string,
  userId: string,
  actor: string,
): Promise<Approval> {
  const current = await getOwnedApproval(id, userId);
  assertTransition(current.status, ApprovalStatus.APPROVED);

  const updated = await prisma.approval.update({
    where: { id },
    data: {
      status: ApprovalStatus.APPROVED,
      decidedBy: actor,
      decidedAt: new Date(),
      failureReason: null,
    },
  });

  await recordAudit({
    type: 'approval_updated',
    message: `Approval ${id} approved. Awaiting dispatch.`,
    data: { previousStatus: current.status },
    userId,
    actor,
    approvalId: id,
  });

  return updated;
}

export async function rejectApproval(
  id: string,
  userId: string,
  actor: string,
  reason?: string,
): Promise<Approval> {
  const current = await getOwnedApproval(id, userId);
  assertTransition(current.status, ApprovalStatus.REJECTED);

  const updated = await prisma.approval.update({
    where: { id },
    data: {
      status: ApprovalStatus.REJECTED,
      decidedBy: actor,
      decidedAt: new Date(),
      failureReason: reason ?? null,
    },
  });

  await recordAudit({
    type: 'approval_updated',
    message: `Approval ${id} rejected.`,
    data: { previousStatus: current.status, reason },
    userId,
    actor,
    approvalId: id,
  });

  return updated;
}

/**
 * The only path to an outbound send.
 *
 * Requires the item to already be APPROVED, so a PENDING item can never be
 * dispatched and an agent has no route to this function. Transport failure
 * lands the item in FAILED with the reason recorded rather than retrying.
 */
export async function dispatchApproval(
  id: string,
  userId: string,
  actor: string,
): Promise<Approval> {
  const current = await getOwnedApproval(id, userId);

  if (current.status !== ApprovalStatus.APPROVED) {
    throw new ApprovalStateError(current.status, ApprovalStatus.SENT);
  }

  const content =
    current.editedAction ??
    (current.decision as { recommendedAction?: string })?.recommendedAction ??
    '';

  try {
    const result = await dispatchOutbound({
      approvalId: current.id,
      channel: current.channel,
      recipient: current.recipient,
      content,
    });

    const updated = await prisma.approval.update({
      where: { id },
      data: {
        status: ApprovalStatus.SENT,
        dispatchedAt: new Date(),
        failureReason: null,
      },
    });

    await recordAudit({
      type: 'approval_dispatched',
      message: `Approval ${id} dispatched via ${result.transport}.`,
      data: { transport: result.transport, providerRef: result.providerRef },
      userId,
      actor,
      approvalId: id,
    });

    return updated;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown dispatch failure.';

    logger.error('Outbound dispatch failed', { approvalId: id, reason });

    const updated = await prisma.approval.update({
      where: { id },
      data: { status: ApprovalStatus.FAILED, failureReason: reason },
    });

    await recordAudit({
      type: 'approval_dispatch_failed',
      message: `Dispatch of approval ${id} failed.`,
      data: { reason },
      userId,
      actor,
      approvalId: id,
    });

    return updated;
  }
}
