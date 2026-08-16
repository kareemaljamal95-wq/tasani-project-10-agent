import type { AuditType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger, redact } from '@/lib/logger';

export interface AuditInput {
  type: AuditType;
  message: string;
  data?: unknown;
  actor?: string;
  userId?: string;
  approvalId?: string;
}

/**
 * Writes an audit row.
 *
 * Never throws: an audit failure must not take down the request that triggered
 * it, but it must be loud in the logs. Payloads pass through `redact` first so
 * a stored audit record cannot become a credential leak.
 */
export async function recordAudit(input: AuditInput) {
  try {
    return await prisma.auditLog.create({
      data: {
        type: input.type,
        message: input.message,
        data: (redact(input.data) ?? undefined) as Prisma.InputJsonValue,
        actor: input.actor ?? null,
        userId: input.userId ?? null,
        approvalId: input.approvalId ?? null,
      },
    });
  } catch (error) {
    logger.error('Failed to write audit log', {
      type: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listAuditLogs(userId: string, limit = 100) {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 500),
  });
}
