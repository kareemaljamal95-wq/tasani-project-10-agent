import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AgentSystem } from '@/lib/ai/agent-system';
import { AGENT_TYPES } from '@/lib/ai/agent-defaults';
import { prisma } from '@/lib/prisma';
import { hasAnyAIProvider } from '@/lib/env';
import {
  ConversationAccessError,
  resolveConversation,
  touchConversation,
} from '@/lib/conversations';
import { handleRouteError, parseBody, rateLimit, requireUser } from '@/lib/api/guard';

const agentChatSchema = z.object({
  // Constrained to known agent types so the value cannot be used to select an
  // arbitrary prompt or model.
  agentType: z.enum(AGENT_TYPES as [string, ...string[]]),
  message: z.string().min(1).max(20_000),
  conversationId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`agent-chat:${session.userId}`, 20);

    if (!hasAnyAIProvider()) {
      return NextResponse.json(
        {
          error:
            'No AI provider is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY.',
        },
        { status: 503 },
      );
    }

    const body = await parseBody(req, agentChatSchema);

    const convId = await resolveConversation({
      userId: session.userId,
      conversationId: body.conversationId,
      title: `[${body.agentType}] ${body.message}`,
      agentType: body.agentType,
    });

    await prisma.message.create({
      data: {
        content: body.message,
        role: 'user',
        conversationId: convId,
        agentId: body.agentType,
      },
    });

    const response = await new AgentSystem(session.userId).chat(
      body.agentType,
      body.message,
      convId,
    );

    await prisma.message.create({
      data: {
        content: response.content,
        role: 'assistant',
        conversationId: convId,
        agentId: body.agentType,
        metadata: response.metadata,
        model: response.metadata?.model,
      },
    });

    await touchConversation(convId);

    return NextResponse.json({ ...response, conversationId: convId });
  } catch (error) {
    if (error instanceof ConversationAccessError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleRouteError(error, 'POST /api/agents/chat');
  }
}
