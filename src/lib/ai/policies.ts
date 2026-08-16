import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';

/**
 * Autonomy policy — evaluated before any agent runs, and again against the
 * agent's own output.
 *
 * Ported from the tasami-ai build and extended: budgets are per agent type,
 * the manual-override switch is per user and persisted, and a blocked run is
 * recorded rather than silently dropped.
 */

export interface PolicyResult {
  blocked: boolean;
  requiresHumanApproval: boolean;
  reason: string;
}

export interface PolicyInput {
  userId: string;
  agentId: string;
  objective: string;
  amountUsd?: number;
}

/**
 * Micro-budget per agent type, in USD. A proposal above the agent's ceiling
 * still runs, but its result cannot be autonomous.
 */
const MICRO_BUDGET_USD: Record<string, number> = {
  CEO: 0, // strategic decisions always go to a human
  SALES: 250,
  SUPPORT: 100,
  CUSTOMER_SUPPORT: 100,
  MARKETING: 1000,
  CONTENT: 150,
  RESEARCH: 50,
  FINANCE: 0,
  OPERATIONS: 200,
};

/**
 * Actions no agent may take regardless of budget or override state. Matched
 * case-insensitively against the objective in both English and Arabic.
 */
const FORBIDDEN_PATTERNS = [
  'transfer ownership',
  'نقل الملكية',
  'تغيير المالك',
  'withdraw all',
  'سحب كامل',
  'delete company',
  'حذف الشركة',
  'change legal structure',
  'تغيير الهيكل القانوني',
  'wire transfer',
  'تحويل بنكي',
];

const MANUAL_OVERRIDE_PREFIX = 'manualOverride:';

export async function getManualOverride(userId: string): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: `${MANUAL_OVERRIDE_PREFIX}${userId}` },
  });

  return row?.value === true;
}

export async function setManualOverride(
  userId: string,
  enabled: boolean,
  actor: string,
): Promise<boolean> {
  const key = `${MANUAL_OVERRIDE_PREFIX}${userId}`;

  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: enabled, updatedBy: actor },
    update: { value: enabled, updatedBy: actor },
  });

  await recordAudit({
    type: 'override_updated',
    message: `Manual override ${enabled ? 'enabled' : 'disabled'}.`,
    data: { manualOverride: enabled },
    userId,
    actor,
  });

  return enabled;
}

export async function evaluatePolicy(input: PolicyInput): Promise<PolicyResult> {
  const objective = input.objective.toLowerCase();

  const forbidden = FORBIDDEN_PATTERNS.find((pattern) =>
    objective.includes(pattern.toLowerCase()),
  );

  if (forbidden) {
    return {
      blocked: true,
      requiresHumanApproval: true,
      reason:
        'Blocked by sovereignty policy: ownership, legal structure and fund-movement actions are never autonomous.',
    };
  }

  const budget = MICRO_BUDGET_USD[input.agentId];

  if (budget === undefined) {
    return {
      blocked: true,
      requiresHumanApproval: true,
      reason: `Unknown agent: ${input.agentId}.`,
    };
  }

  if (await getManualOverride(input.userId)) {
    return {
      blocked: false,
      requiresHumanApproval: true,
      reason: 'Manual override is active — every action requires approval.',
    };
  }

  if (typeof input.amountUsd === 'number' && input.amountUsd > budget) {
    return {
      blocked: false,
      requiresHumanApproval: true,
      reason: `Amount $${input.amountUsd} exceeds the ${input.agentId} micro-budget of $${budget}.`,
    };
  }

  if (budget === 0) {
    return {
      blocked: false,
      requiresHumanApproval: true,
      reason: `${input.agentId} decisions require human approval by default.`,
    };
  }

  return {
    blocked: false,
    requiresHumanApproval: false,
    reason: 'Within micro-budget and autonomy policy.',
  };
}
