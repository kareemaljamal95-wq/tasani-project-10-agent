import { getAgent } from "./agents";
import type { AgentRunRequest } from "./schemas";

export interface PolicyResult {
  blocked: boolean;
  requiresHumanApproval: boolean;
  reason: string;
}

const forbiddenPatterns = [
  "transfer ownership",
  "نقل الملكية",
  "تغيير المالك",
  "withdraw all",
  "سحب كامل",
  "delete company",
  "حذف الشركة",
  "change legal structure",
  "تغيير الهيكل القانوني"
];

export function evaluatePolicy(
  input: AgentRunRequest,
  manualOverride: boolean
): PolicyResult {
  const normalizedObjective = input.objective.toLowerCase();
  const agent = getAgent(input.agentId);

  if (!agent) {
    return {
      blocked: true,
      requiresHumanApproval: true,
      reason: "Unknown agent."
    };
  }

  const containsForbiddenAction = forbiddenPatterns.some((pattern) =>
    normalizedObjective.includes(pattern.toLowerCase())
  );

  if (containsForbiddenAction) {
    return {
      blocked: true,
      requiresHumanApproval: true,
      reason:
        "Blocked by Human Sovereignty Policy: ownership, legal structure, or full-balance actions are not autonomous."
    };
  }

  if (manualOverride) {
    return {
      blocked: false,
      requiresHumanApproval: true,
      reason:
        "Manual Override is active. All autonomous execution requires founder approval."
    };
  }

  if (typeof input.amountUsd === "number" && input.amountUsd > agent.microBudgetUsd) {
    return {
      blocked: false,
      requiresHumanApproval: true,
      reason: `Amount exceeds ${agent.name} micro-budget of $${agent.microBudgetUsd}.`
    };
  }

  const normId = input.agentId.startsWith("omni-") ? input.agentId : `omni-${input.agentId}`;
  if (normId === "omni-ceo") {
    return {
      blocked: false,
      requiresHumanApproval: true,
      reason: "OmniCEO decisions require founder approval by default."
    };
  }

  return {
    blocked: false,
    requiresHumanApproval: false,
    reason: "Allowed within micro-budget and autonomy policy."
  };
}
