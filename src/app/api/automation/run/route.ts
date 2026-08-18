import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { evaluateAllTriggers, processJobs } from '@/lib/automation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { handleRouteError } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The automation worker endpoint.
 *
 * Drives the loop: evaluate triggers, then drain the job queue. Designed to be
 * called on a schedule — a platform cron, a Cloud Scheduler job, or any
 * external timer — because the application has no long-running process of its
 * own and adding one would mean a second deployment unit to operate.
 *
 * Two ways in, and no third:
 *  - a worker credential in `x-worker-key`, for the scheduler
 *  - a signed-in session, which processes only that account's own jobs
 *
 * Without WORKER_API_KEY set, the unattended path is closed entirely rather
 * than defaulting open.
 */
function isAuthorizedWorker(req: Request): boolean {
  const expected = env().WORKER_API_KEY;
  if (!expected) return false;

  const provided = req.headers.get('x-worker-key');
  if (!provided) return false;

  // Compared through a hash so the check is constant-time regardless of length.
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    const workerAuthorized = isAuthorizedWorker(req);
    const session = workerAuthorized ? null : await getSession();

    if (!workerAuthorized && !session) {
      return NextResponse.json(
        { error: 'Worker credential or an authenticated session is required.' },
        { status: 401 },
      );
    }

    const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

    // A signed-in operator can only evaluate their own triggers; the scheduler
    // credential evaluates everyone's.
    let enqueued = 0;

    if (workerAuthorized) {
      enqueued = await evaluateAllTriggers();
    } else if (session) {
      const triggers = await prisma.automationTrigger.findMany({
        where: { userId: session.userId, enabled: true },
        select: { id: true },
      });

      const { evaluateTrigger } = await import('@/lib/automation');
      for (const trigger of triggers) {
        const result = await evaluateTrigger(trigger.id);
        enqueued += result.enqueued;
      }
    }

    const drained = await processJobs(workerId, workerAuthorized ? 25 : 5);

    logger.info('Automation cycle complete', { enqueued, ...drained });

    return NextResponse.json({ ok: true, enqueued, ...drained });
  } catch (error) {
    return handleRouteError(error, 'POST /api/automation/run');
  }
}
