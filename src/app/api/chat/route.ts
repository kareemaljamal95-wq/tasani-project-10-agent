import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse } from '@/lib/ai/provider';
import { AgentSystem } from '@/lib/ai/agent-system';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/utils';

export async function POST(req: NextRequest) {
  try {
    const { message, conversationId, agentType, stream } = await req.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const userId = 'demo-user'; // TODO: get from auth

    let convId = conversationId;
    if (!convId) {
      const conversation = await prisma.conversation.create({
        data: {
          title: message.slice(0, 100),
          userId,
          agentType: agentType ?? null,
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
      },
    });

    const agentSystem = new AgentSystem(userId);

    if (agentType) {
      const response = await agentSystem.chat(agentType as any, message, convId);

      await prisma.message.create({
        data: {
          content: response.content,
          role: 'assistant',
          conversationId: convId,
          agentId: agentType,
          metadata: response.metadata as any,
          model: (response.metadata as any)?.model,
        },
      });

      return NextResponse.json({
        content: response.content,
        conversationId: convId,
        agentType,
        actions: response.actions,
      });
    }

    const response = await generateAIResponse({
      messages: [{ role: 'user', content: message }],
      systemPrompt: 'You are KARMISH, a personal AI operating system. Help the user with their tasks, business, and personal growth.',
    });

    await prisma.message.create({
      data: {
        content: response.content,
        role: 'assistant',
        conversationId: convId,
        model: response.model,
      },
    });

    return NextResponse.json({
      content: response.content,
      conversationId: convId,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = 'demo-user';
    const conversations = await prisma.conversation.findMany({
      where: { userId, isArchived: false },
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    const summaries = conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      lastMessage: conv.messages[0]?.content,
      agentType: conv.agentType,
      messageCount: conv._count.messages,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));

    return NextResponse.json({ conversations: summaries });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}
