import { generateAIResponse } from './provider';
import { MemorySystem } from './memory';
import { prisma } from '@/lib/prisma';
import type { AgentType } from '@/types/agent';

export interface AgentChatResponse {
  content: string;
  metadata: {
    model: string;
    provider: string;
    agentType: string;
  };
  actions?: any[];
}

export class AgentSystem {
  private userId: string;
  private memorySystem: MemorySystem;

  constructor(userId: string) {
    this.userId = userId;
    this.memorySystem = new MemorySystem(userId);
  }

  async chat(agentType: string, message: string, conversationId: string): Promise<AgentChatResponse> {
    const agentConfig = await prisma.agentConfig.findFirst({
      where: { userId: this.userId, type: agentType, isEnabled: true },
    });

    const systemPrompt = agentConfig?.systemPrompt ?? this.getDefaultPrompt(agentType);
    const model = agentConfig?.model ?? 'gpt-4o';
    const temperature = agentConfig?.temperature ?? 0.7;

    const recentMemories = await this.memorySystem.getRecent(5);
    const memoryContext = recentMemories.length > 0
      ? `\nRelevant memories:\n${recentMemories.map(m => `- [${m.type}] ${m.content}`).join('\n')}`
      : '';

    const response = await generateAIResponse({
      messages: [{ role: 'user', content: message }],
      systemPrompt: systemPrompt + memoryContext,
      model,
      temperature,
    });

    return {
      content: response.content,
      metadata: {
        model: response.model,
        provider: response.provider,
        agentType,
      },
    };
  }

  private getDefaultPrompt(agentType: string): string {
    const prompts: Record<string, string> = {
      CEO: 'You are the CEO Agent. Provide strategic business leadership, make high-level decisions, and oversee business operations. Think like a visionary CEO.',
      SALES: 'You are the Sales Agent. Qualify leads, handle objections, suggest closing strategies, and generate follow-ups. Think like a top-performing salesperson.',
      MARKETING: 'You are the Marketing Agent. Research markets, analyze competitors, create content strategies, and optimize campaigns. Think like a CMO.',
      RESEARCH: 'You are the Research Agent. Conduct deep research, synthesize information, and provide comprehensive analysis. Think like a research scientist.',
      FINANCE: 'You are the Finance Agent. Analyze financial data, optimize revenue, manage budgets, and provide financial insights. Think like a CFO.',
      OPERATIONS: 'You are the Operations Agent. Optimize workflows, manage processes, and ensure operational efficiency. Think like a COO.',
      FASHION: 'You are the Fashion Agent. Provide fashion advice, manage inventory, suggest trends, and optimize pricing. Think like a fashion director.',
      CUSTOMER_SUPPORT: 'You are the Support Agent. Handle customer inquiries, resolve issues, and ensure customer satisfaction. Think like a support manager.',
    };

    return prompts[agentType] || 'You are an AI assistant. Help the user with their request.';
  }
}

export async function ceoAgentOrchestrator(goalInput: string, userId: string) {
  const systemPrompt = `
    أنت المدير التنفيذي للنظام. قم بتفكيك الهدف التالي إلى قائمة مهام تقنية محددة.
    يجب أن يكون الرد بصيغة JSON فقط كالتالي:
    {"tasks": [{"title": "عنوان المهمة", "description": "وصفها", "priority": "HIGH", "agent": "SALES"}]}
  `;

  const aiResponse = await generateAIResponse({
    messages: [{ role: 'user', content: goalInput }],
    systemPrompt,
    model: 'gemini-pro',
  });

  const cleaned = aiResponse.content.replace(/```json\s*|\s*```/g, '').trim();
  const parsedData = JSON.parse(cleaned);

  const createdTasks = await Promise.all(
    parsedData.tasks.map((task: any) =>
      prisma.task.create({
        data: {
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: 'PENDING',
          userId,
        },
      })
    )
  );

  return createdTasks;
}
