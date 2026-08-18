import { JobStatus, Prisma, type Job } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Minimal durable job queue, backed by Postgres.
 *
 * Chosen over a workflow platform because the application already depends on
 * Postgres and nothing else; adding Redis, BullMQ or Temporal for this volume
 * would be more infrastructure to operate than the feature justifies.
 *
 * Guarantees:
 *  - at-most-one worker per job, via FOR UPDATE SKIP LOCKED
 *  - no duplicate work, via a unique idempotency key per account
 *  - bounded retries with exponential backoff
 *  - stale locks reclaimed, so a crashed worker does not strand a job
 *  - every outcome recorded on the row, so failures are visible
 */

export const JOB_KINDS = ['lead_agent_action'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** A job locked for longer than this is assumed to belong to a dead worker. */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export interface EnqueueInput {
  userId: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  leadId?: string;
  triggerId?: string;
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Stable key describing the work. A repeated trigger with the same key is
   * dropped instead of queueing a second identical action.
   */
  idempotencyKey?: string;
}

export type EnqueueResult =
  | { enqueued: true; job: Job }
  | { enqueued: false; reason: 'duplicate' };

export async function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  try {
    const job = await prisma.job.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        payload: input.payload as Prisma.InputJsonValue,
        leadId: input.leadId ?? null,
        triggerId: input.triggerId ?? null,
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 3,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    return { enqueued: true, job };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return { enqueued: false, reason: 'duplicate' };
    }
    throw error;
  }
}

/**
 * Claims one runnable job.
 *
 * SKIP LOCKED is what makes this safe to run from several workers at once:
 * a row already locked by another transaction is passed over instead of
 * blocking, so two workers never take the same job.
 */
export async function claimNextJob(workerId: string): Promise<Job | null> {
  const staleBefore = new Date(Date.now() - LOCK_TIMEOUT_MS);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH claimed AS (
      SELECT "id" FROM "Job"
      WHERE "runAt" <= NOW()
        AND (
          "status" = 'PENDING'
          OR ("status" = 'RUNNING' AND "lockedAt" < ${staleBefore})
        )
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "Job" j
    SET "status" = 'RUNNING',
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        "attempts" = j."attempts" + 1,
        "updatedAt" = NOW()
    FROM claimed
    WHERE j."id" = claimed."id"
    RETURNING j."id"
  `;

  if (rows.length === 0) return null;

  return prisma.job.findUnique({ where: { id: rows[0].id } });
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.SUCCEEDED,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

/**
 * Records a failure and either schedules a retry with exponential backoff or
 * gives up once maxAttempts is spent. A dead job keeps its error message so
 * the failure stays visible rather than disappearing from the queue.
 */
export async function failJob(jobId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  const exhausted = job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(2 ** job.attempts, 60) * 1000;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: exhausted ? JobStatus.FAILED : JobStatus.PENDING,
      lastError: message.slice(0, 1000),
      lockedAt: null,
      lockedBy: null,
      ...(exhausted ? {} : { runAt: new Date(Date.now() + backoffMs) }),
    },
  });

  logger.warn('Job failed', {
    jobId,
    attempts: job.attempts,
    exhausted,
    error: message,
  });
}

export async function listJobs(userId: string, limit = 50) {
  return prisma.job.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}
