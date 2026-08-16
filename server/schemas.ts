import { z } from "zod";

export const agentIdSchema = z.enum([
  "omni-ceo",
  "omni-seller",
  "omni-support",
  "omni-marketing",
  "omni-content",
  "ceo",
  "seller",
  "support",
  "marketing",
  "content"
]);

export const agentRunRequestSchema = z.object({
  agentId: agentIdSchema,
  objective: z.string().min(5).max(4000),
  requester: z.string().optional().default("founder"),
  channel: z.string().optional(),
  amountUsd: z.number().nonnegative().optional(),
  context: z.record(z.string(), z.unknown()).optional().default({})
});

export const agentDecisionSchema = z.object({
  decision: z.string(),
  recommendedAction: z.string(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1),
  requiresHumanApproval: z.boolean(),
  rationaleSummary: z.string(),
  expectedBusinessImpact: z.string(),
  suggestedNextStep: z.string()
});

export type AgentId = z.infer<typeof agentIdSchema>;
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalItem {
  id: string;
  createdAt: string;
  agentId: AgentId;
  objective: string;
  amountUsd?: number;
  status: ApprovalStatus;
  decision: AgentDecision;
}

export interface AuditLogItem {
  id: string;
  createdAt: string;
  type:
    | "agent_run"
    | "approval_created"
    | "approval_updated"
    | "override_updated"
    | "policy_blocked";
  message: string;
  data?: unknown;
}
