import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleRouteError,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

/**
 * Single conversation with its messages.
 *
 * GET /api/chat returned a list of conversations and nothing else, so the UI
 * could show that a thread existed but never open it.
 *
 * Ownership is enforced in the query itself — `findFirst` on both id and
 * userId — so another account's conversation id is indistinguishable from a
 * nonexistent one. Message metadata is not returned: it carries the model and
 * provider used, which is backend configuration rather than conversation
 * content.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await requireUser();
    const { conversationId } = await params;

    rateLimit(`conversation:${session.userId}`);

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: session.userId },
      select: {
        id: true,
        title: true,
        agentType: true,
        isActive: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found.' },
        { status: 404 },
      );
    }

    const { searchParams } = new URL(req.url);

    const limit = Math.min(
      Math.max(
        Number.parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) ||
          DEFAULT_LIMIT,
        1,
      ),
      MAX_LIMIT,
    );

    const cursor = searchParams.get('cursor');

    // Ordered oldest-first so the client renders a transcript directly; the
    // cursor pages forward through the thread.
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        content: true,
        role: true,
        agentId: true,
        createdAt: true,
      },
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;

    return NextResponse.json({
      conversation,
      messages: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (error) {
    return handleRouteError(error, 'GET /api/chat/[conversationId]');
  }
}

/** Archives a conversation. Scoped by userId, so a foreign id 404s. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await requireUser();
    const { conversationId } = await params;

    const result = await prisma.conversation.updateMany({
      where: { id: conversationId, userId: session.userId },
      data: { isArchived: true, isActive: false },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: 'Conversation not found.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/chat/[conversationId]');
  }
}
