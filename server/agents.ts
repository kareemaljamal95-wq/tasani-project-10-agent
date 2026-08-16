import type { AgentId } from "./schemas";

export interface ServerAgent {
  id: AgentId;
  name: string;
  role: string;
  microBudgetUsd: number;
}

export const agents: ServerAgent[] = [
  {
    id: "omni-ceo",
    name: "OmniCEO",
    role: "تنسيق الوكلاء، تحليل القرارات، واقتراح المسارات التنفيذية",
    microBudgetUsd: 0
  },
  {
    id: "omni-seller",
    name: "OmniSeller",
    role: "إدارة محادثات البيع، الخصومات المحدودة، وتحسين الإغلاق",
    microBudgetUsd: 250
  },
  {
    id: "omni-support",
    name: "OmniSupport",
    role: "حل مشاكل العملاء، تصنيف التذاكر، وتقديم ردود الدعم",
    microBudgetUsd: 100
  },
  {
    id: "omni-marketing",
    name: "OmniMarketing",
    role: "اباقتراح الحملات، تحليل الجمهور، وتحسين الإنفاق الإعلاني",
    microBudgetUsd: 1000
  },
  {
    id: "omni-content",
    name: "OmniContent",
    role: "إنشاء المحتوى، كتابة الحملات، وتجهيز المواد التسويقية",
    microBudgetUsd: 150
  }
];

export function getAgent(agentId: AgentId): ServerAgent | undefined {
  const normId = agentId.startsWith("omni-") ? agentId : `omni-${agentId}`;
  return agents.find((agent) => agent.id === normId);
}
