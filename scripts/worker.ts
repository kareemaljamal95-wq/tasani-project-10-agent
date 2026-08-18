/**
 * Standalone automation worker.
 *
 * An alternative to calling POST /api/automation/run on a schedule, for
 * deployments that prefer a long-running process (a container, a systemd
 * unit) over an external timer. Same code path either way — it evaluates
 * triggers and drains the queue through `processJobs`.
 *
 * Run with: npm run worker
 */
import crypto from 'node:crypto';
import { evaluateAllTriggers, processJobs } from '../src/lib/automation';
import { logger } from '../src/lib/logger';

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 30_000);
const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;

let stopping = false;

async function cycle(): Promise<void> {
  try {
    const enqueued = await evaluateAllTriggers();
    const drained = await processJobs(workerId, 25);

    if (enqueued > 0 || drained.processed > 0) {
      logger.info('Automation cycle', { workerId, enqueued, ...drained });
    }
  } catch (error) {
    // A failed cycle must not kill the worker; the next tick retries.
    logger.error('Automation cycle failed', {
      workerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  logger.info('Automation worker started', { workerId, intervalMs: INTERVAL_MS });

  while (!stopping) {
    await cycle();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  logger.info('Automation worker stopped', { workerId });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Lets the in-flight cycle finish; jobs it claimed are already locked and
    // would otherwise wait out the stale-lock timeout.
    stopping = true;
  });
}

void main();
