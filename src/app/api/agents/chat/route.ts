import { NextRequest, NextResponse } from 'next/server';
import { AgentSystem } from '@/lib/ai/agent-system';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const { agentType, message, conversationId } = await req.json();

    if (!agentType || !message) {
      return NextResponse.json({ error: 'agentType and message are required' }, { status: 400 });
    }

    const userId = 'demo-user';
    const agentSystem = new AgentSystem(userId);

    let convId = conversationId;
    if (!convId) {
      const conversation = await prisma.conversation.create({
        data: {
          title: `[${agentType}] ${message.slice(0, 100)}`,
          userId,
          agentType,
          isActive: true,
        },
      });
      convId = conversation.id;
    }

    await prisma.message.create({
      data: {
        content: message,
        role: 'user',
        conversationId: convId,
        agentId: agentType,
      },
    });

    const response = await agentSystem.chat(agentType, message, convId);

    await prisma.message.create({
      data: {
        content: response.content,
        role: 'assistant',
        conversationId: convId,
        agentId: agentType,
        metadata: response.metadata as any,
      },
    });

    return NextResponse.json({
      ...response,
      conversationId: convId,
    });
  } catch (error) {
    console.error('Agent chat error:', error);
    return NextResponse.json({ error: 'Failed to process agent chat' }, { status: 500 });
  }
}
