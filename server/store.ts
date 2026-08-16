import type { ApprovalItem, AuditLogItem } from "./schemas";

interface TasamiStore {
  manualOverride: boolean;
  approvals: ApprovalItem[];
  auditLogs: AuditLogItem[];
}

declare global {
  // eslint-disable-next-line no-var
  var __tasamiStore: TasamiStore | undefined;
}

export function getStore(): TasamiStore {
  if (!globalThis.__tasamiStore) {
    globalThis.__tasamiStore = {
      manualOverride: false,
      approvals: [
        {
          id: "app-1",
          createdAt: new Date().toISOString(),
          agentId: "omni-seller",
          objective: "تطبيق خصم تلقائي بقيمة 25% للعميل المشتري ذي القيمة العالية #1092",
          amountUsd: 12,
          status: "pending",
          decision: {
            decision: "موافق عليها تجارياً بحدود",
            recommendedAction: "تطبيق خصم 25% للعميل #1092",
            riskLevel: "medium",
            confidence: 0.95,
            requiresHumanApproval: true,
            rationaleSummary: "حفز العميل للشراء وتعميق العلاقة بمعدل عائد ممتاز",
            expectedBusinessImpact: "زيادة ولاء العملاء بـ 94%",
            suggestedNextStep: "طلب موافقة المؤسس وتوليد رمز الخصم"
          }
        },
        {
          id: "app-2",
          createdAt: new Date().toISOString(),
          agentId: "omni-marketing",
          objective: "إطلاق حملة تسويقية مستهدفة بقيمة 1,500$ لمستهلكي السلات المهجورة",
          amountUsd: 1500,
          status: "pending",
          decision: {
            decision: "موافقة على التخصيص التسويقي",
            recommendedAction: "إطلاق حملة مستهدفة بميزانية قدرها 1500 دولار للسلات المهجورة",
            riskLevel: "high",
            confidence: 0.92,
            requiresHumanApproval: true,
            rationaleSummary: "يتعدى الميزانية الافتراضية، ولكنه يملك عائداً متوقعاً ممتازاً",
            expectedBusinessImpact: "تحقيق عائد إعلاني ROAS بحدود 5.4x",
            suggestedNextStep: "طلب موافقة المؤسس للمرور للتنفيذ"
          }
        },
        {
          id: "app-3",
          createdAt: new Date().toISOString(),
          agentId: "omni-ceo",
          objective: "تحديث سياسة الرد التلقائي للتوافق مع شروط حماية المستهلك لعام 2026",
          status: "pending",
          decision: {
            decision: "مواءمة قانونية شاملة",
            recommendedAction: "تحديث الشروط والأحكام وسياسات الرد التلقائي",
            riskLevel: "medium",
            confidence: 0.98,
            requiresHumanApproval: true,
            rationaleSummary: "ضمان حماية قانونية ضد اللوائح المحدثة لعام 2026",
            expectedBusinessImpact: "تأمين الامتثال وتفادي المخالفات بنسبة 100%",
            suggestedNextStep: "عرض المستند القانوني على المؤسس للتوقيع والموافقة"
          }
        }
      ],
      auditLogs: []
    };
  }

  return globalThis.__tasamiStore;
}

export function addAuditLog(
  type: AuditLogItem["type"],
  message: string,
  data?: unknown
) {
  const store = getStore();

  const item: AuditLogItem = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
    createdAt: new Date().toISOString(),
    type,
    message,
    data
  };

  store.auditLogs.unshift(item);

  return item;
}
