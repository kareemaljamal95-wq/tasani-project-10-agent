import type { ActivityType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger, redact } from '@/lib/logger';

/**
 * Lead timeline.
 *
 * Deliberately separate from AuditLog: AuditLog is the security and compliance
 * record (auth events, policy blocks, approval transitions, redacted and
 * retained), while this is the account's own readable history of work on a
 * prospect. Merging them would force one retention and redaction policy onto
 * two different audiences.
 */
export interface ActivityInput {
  userId: string;
  leadId?: string;
  type: ActivityType;
  message: string;
  data?: unknown;
  actor?: string;
}

/** Never throws: a timeline write must not fail the action it describes. */
export async function recordActivity(input: ActivityInput) {
  try {
    return await prisma.activity.create({
      data: {
        userId: input.userId,
        leadId: input.leadId ?? null,
        type: input.type,
        message: input.message,
        data: (redact(input.data) ?? undefined) as Prisma.InputJsonValue,
        actor: input.actor ?? null,
      },
    });
  } catch (error) {
    logger.error('Failed to write activity', {
      type: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listLeadActivities(
  leadId: string,
  userId: string,
  limit = 50,
) {
  return prisma.activity.findMany({
    // Scoped by userId as well as leadId so a guessed lead id reads nothing.
    where: { leadId, userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}
