import { prisma } from '@/lib/prisma';

/**
 * Conversation ownership.
 *
 * The chat routes accept a `conversationId` from the client. Without this
 * check, passing another account's id read that thread's history and appended
 * messages to it — the routes previously did exactly that.
 */

export class ConversationAccessError extends Error {
  constructor() {
    super('Conversation not found.');
    this.name = 'ConversationAccessError';
  }
}

/**
 * Returns the id of a conversation the user owns, creating one when no id was
 * supplied. Throws when the caller does not own the referenced conversation.
 */
export async function resolveConversation(params: {
  userId: string;
  conversationId?: string | null;
  title: string;
  agentType?: string | null;
}): Promise<string> {
  const { userId, conversationId, title, agentType } = params;

  if (conversationId) {
    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });

    if (!existing) throw new ConversationAccessError();
    return existing.id;
  }

  const created = await prisma.conversation.create({
    data: {
      title: title.slice(0, 100),
      userId,
      agentType: agentType ?? null,
      isActive: true,
    },
    select: { id: true },
  });

  return created.id;
}

/** Bumps `updatedAt` so conversation lists sort by real activity. */
export async function touchConversation(conversationId: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}
