import { GoogleGenAI, Type } from "@google/genai";
import { getAgent } from "./agents";
import { agentDecisionSchema, type AgentRunRequest } from "./schemas";
import type { PolicyResult } from "./policies";

export async function runGeminiAgent(
  input: AgentRunRequest,
  policy: PolicyResult
) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing. Please configure it in Secrets.");
  }

  const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });

  const agent = getAgent(input.agentId);

  if (!agent) {
    throw new Error("Unknown agent ID provided.");
  }

  const systemPrompt = `
أنت ${agent.name} داخل تسامي OS (Tasami OS).

دورك الأساسي:
${agent.role}

قواعد السيادة الإنسانية والسياسات الصارمة:
- المؤسس البشري هو السلطة السيادية المطلقة للنظام.
- يمنع منعاً باتاً تنفيذ أو اقتراح أي تغيير في الملكية، أو تعديل في الهيكل القانوني للشركة، أو محاولة سحب كامل الأرصدة التلقائية.
- لا تظهر تفاصيل سلسلة التفكير الداخلية الخام للمستخدم، بل قدم ملخصاً تنفيذياً وتحليلاً مقتضباً للغاية في حقل "rationaleSummary".
- إذا كان القرار مالياً أو تنظيمياً أو قانونياً أو ذا مخاطر عالية أو يفوق الميزانية الافتراضية، يجب تحديد حقل "requiresHumanApproval" كـ true.
- أخرج مخرجاتك بنسق JSON دقيق يتطابق مع المخطط المدخل تماماً.
`;

  const payload = {
    objective: input.objective,
    requester: input.requester,
    channel: input.channel,
    amountUsd: input.amountUsd,
    context: input.context,
    policy
  };

  const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  const response = await client.models.generateContent({
    model: modelName,
    contents: `${systemPrompt}\n\nالمهمة المطلوب اتخاذ قرار فوري بشأنها وتحليلها بالتفصيل:\n${JSON.stringify(payload, null, 2)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          decision: {
            type: Type.STRING,
            description: "قرار تنفيذي قصير وموجز باللغة العربية"
          },
          recommendedAction: {
            type: Type.STRING,
            description: "الإجراء التشغيلي الموصى به بالتحديد باللغة العربية"
          },
          riskLevel: {
            type: Type.STRING,
            description: "مستوى المخاطرة: 'low' أو 'medium' أو 'high' أو 'critical'"
          },
          confidence: {
            type: Type.NUMBER,
            description: "معدل الثقة في هذا القرار من 0 إلى 1"
          },
          requiresHumanApproval: {
            type: Type.BOOLEAN,
            description: "ما إذا كان الإجراء يتطلب موافقة يدوية صريحة من المؤسس البشري بموجب قواعد السيادة"
          },
          rationaleSummary: {
            type: Type.STRING,
            description: "ملخص تنفيذي مقنع للمبررات الإستراتيجية وراء هذا القرار باللغة العربية"
          },
          expectedBusinessImpact: {
            type: Type.STRING,
            description: "الأثر المتوقع على الأعمال والأرقام المستهدفة باللغة العربية"
          },
          suggestedNextStep: {
            type: Type.STRING,
            description: "الخطوة التالية المقترحة للمؤسس أو النظام باللغة العربية"
          }
        },
        required: [
          "decision",
          "recommendedAction",
          "riskLevel",
          "confidence",
          "requiresHumanApproval",
          "rationaleSummary",
          "expectedBusinessImpact",
          "suggestedNextStep"
        ]
      }
    }
  });

  const rawText = response.text || "{}";
  const parsed = JSON.parse(rawText.trim());
  const decision = agentDecisionSchema.parse(parsed);

  return {
    ...decision,
    requiresHumanApproval:
      decision.requiresHumanApproval || policy.requiresHumanApproval
  };
}
