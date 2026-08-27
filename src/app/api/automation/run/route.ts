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

  return secretsMatch(provided, expected);
}

/**
 * Constant-time comparison. Hashing first makes the comparison independent of
 * the secrets' lengths, which timingSafeEqual alone is not.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Vercel Cron's own authorization.
 *
 * Vercel invokes a scheduled path with **GET** and presents `CRON_SECRET` as a
 * bearer token; it cannot be made to send `x-worker-key`. So the scheduler path
 * needs its own door — but the same posture as the worker one: with no
 * `CRON_SECRET` configured this returns false and the door stays shut.
 */
function isAuthorizedCron(req: Request): boolean {
  const expected = env().CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  return secretsMatch(header.slice('Bearer '.length), expected);
}

/**
 * One automation cycle: evaluate triggers, then drain the queue.
 *
 * `scope` decides how much of the fleet is in play. A scheduler credential
 * drives every account; a signed-in operator drives only their own, and gets a
 * smaller drain budget so one person's manual poke cannot monopolise a worker.
 */
async function runCycle(
  scope: { kind: 'scheduler' } | { kind: 'session'; userId: string },
) {
  const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;
  let enqueued = 0;

  if (scope.kind === 'scheduler') {
    enqueued = await evaluateAllTriggers();
  } else {
    const triggers = await prisma.automationTrigger.findMany({
      where: { userId: scope.userId, enabled: true },
      select: { id: true },
    });

    const { evaluateTrigger } = await import('@/lib/automation');
    for (const trigger of triggers) {
      const result = await evaluateTrigger(trigger.id);
      enqueued += result.enqueued;
    }
  }

  // The drain is scoped to the caller's own account on the session path. A
  // signed-in operator poking the worker must not execute work belonging to
  // someone else — it would spend their model budget and file approvals under
  // their name.
  const drained =
    scope.kind === 'scheduler'
      ? await processJobs(workerId, 25)
      : await processJobs(workerId, 5, scope.userId);

  logger.info('Automation cycle complete', { enqueued, ...drained });

  return NextResponse.json({ ok: true, enqueued, ...drained });
}

/**
 * The scheduled entry point (Vercel Cron and anything else that can only GET).
 *
 * Deliberately no session fallback: a GET that mutates state and accepts a
 * cookie is reachable from any page the operator happens to visit. Only a
 * scheduler secret opens this one.
 */
export async function GET(req: Request) {
  try {
    if (!isAuthorizedCron(req) && !isAuthorizedWorker(req)) {
      return NextResponse.json(
        { error: 'A scheduler credential is required.' },
        { status: 401 },
      );
    }

    return await runCycle({ kind: 'scheduler' });
  } catch (error) {
    return handleRouteError(error, 'GET /api/automation/run');
  }
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

    return await runCycle(
      workerAuthorized
        ? { kind: 'scheduler' }
        : { kind: 'session', userId: session!.userId },
    );
  } catch (error) {
    return handleRouteError(error, 'POST /api/automation/run');
  }
}
