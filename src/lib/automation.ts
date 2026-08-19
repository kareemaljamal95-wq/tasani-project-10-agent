import { LeadStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { recordActivity } from '@/lib/activity';
import { executeAgent, ProviderUnavailableError } from '@/lib/agent-execution';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
} from '@/lib/jobs';
import { pruneRateLimitCounters } from '@/lib/rate-limit';
import { expireLapsedSubscriptions } from '@/lib/billing/subscription';

/**
 * The automation layer.
 *
 * Deliberately small: triggers enqueue jobs, a worker drains them, and each job
 * calls the same `executeAgent` a person's click calls. Automation therefore
 * inherits policy evaluation, the approval gate and the audit trail for free,
 * and there is no second execution path where the sovereignty rules could
 * drift.
 *
 * Nothing here can send. The most an automated run produces is a PENDING
 * approval waiting for a human, exactly as a manual run does.
 */

const leadAgentActionPayload = z.object({
  leadId: z.string().min(1),
  agentType: z.string().min(1),
  objective: z.string().min(5),
});

/** Substitutes lead fields into a trigger's objective template. */
export function renderObjective(
  template: string,
  lead: { companyName: string; contactName: string | null; status: string },
): string {
  return template
    .replaceAll('{{company}}', lead.companyName)
    .replaceAll('{{contact}}', lead.contactName ?? '')
    .replaceAll('{{status}}', lead.status);
}

/**
 * Evaluates one trigger and enqueues work for the leads it matches.
 *
 * The idempotency key pins a run to (trigger, lead, day), so re-evaluating the
 * same trigger repeatedly within a day cannot queue the same action twice —
 * the duplicate insert is rejected by the unique constraint rather than
 * producing a second outreach draft.
 */
export async function evaluateTrigger(triggerId: string): Promise<{
  matched: number;
  enqueued: number;
  skipped: number;
}> {
  const trigger = await prisma.automationTrigger.findUnique({
    where: { id: triggerId },
  });

  if (!trigger || !trigger.enabled) {
    return { matched: 0, enqueued: 0, skipped: 0 };
  }

  const cooldownBefore = new Date(
    Date.now() - trigger.cooldownHours * 60 * 60 * 1000,
  );

  const leads = await prisma.lead.findMany({
    where: {
      userId: trigger.userId,
      ...(trigger.leadStatus ? { status: trigger.leadStatus } : {}),
      OR: [
        { lastContactedAt: null },
        { lastContactedAt: { lt: cooldownBefore } },
      ],
    },
    take: 50,
  });

  const day = new Date().toISOString().slice(0, 10);
  let enqueued = 0;
  let skipped = 0;

  for (const lead of leads) {
    const result = await enqueueJob({
      userId: trigger.userId,
      kind: 'lead_agent_action',
      leadId: lead.id,
      triggerId: trigger.id,
      idempotencyKey: `trigger:${trigger.id}:lead:${lead.id}:${day}`,
      payload: {
        leadId: lead.id,
        agentType: trigger.agentType,
        objective: renderObjective(trigger.objectiveTemplate, lead),
      },
    });

    if (result.enqueued) enqueued += 1;
    else skipped += 1;
  }

  await prisma.automationTrigger.update({
    where: { id: trigger.id },
    data: { lastRunAt: new Date() },
  });

  return { matched: leads.length, enqueued, skipped };
}

export async function evaluateAllTriggers(): Promise<number> {
  const triggers = await prisma.automationTrigger.findMany({
    where: { enabled: true },
    select: { id: true },
  });

  let total = 0;
  for (const trigger of triggers) {
    const result = await evaluateTrigger(trigger.id);
    total += result.enqueued;
  }

  return total;
}

/** Runs one job's work. Throws on failure so the queue can retry it. */
async function runJob(job: {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
}): Promise<void> {
  if (job.kind !== 'lead_agent_action') {
    throw new Error(`Unknown job kind: ${job.kind}`);
  }

  const payload = leadAgentActionPayload.parse(job.payload);

  // Re-checked at execution time, not just at enqueue time: the lead may have
  // been deleted or reassigned while the job sat in the queue.
  const lead = await prisma.lead.findFirst({
    where: { id: payload.leadId, userId: job.userId },
  });

  if (!lead) {
    logger.info('Skipping job for missing lead', { jobId: job.id });
    return;
  }

  const result = await executeAgent({
    userId: job.userId,
    actor: 'automation',
    agentId: payload.agentType,
    objective: payload.objective,
    recipient: lead.email ?? undefined,
    channel: lead.email ? 'email' : undefined,
    leadId: lead.id,
    jobId: job.id,
    context: { leadStatus: lead.status, source: lead.source },
  });

  await recordActivity({
    userId: job.userId,
    leadId: lead.id,
    type: 'automation',
    message:
      result.status === 'blocked'
        ? 'حظرت السياسة إجراءً آليًا.'
        : result.status === 'approval_required'
          ? 'أنشأت الأتمتة مقترحًا بانتظار اعتمادك.'
          : 'نفّذت الأتمتة إجراءً ضمن الصلاحية.',
    data: { jobId: job.id, status: result.status },
    actor: 'automation',
  });
}

/**
 * Drains the queue.
 *
 * Called by the worker endpoint or a scheduled invocation. Bounded by `max` so
 * a single call cannot run indefinitely under a serverless timeout.
 */
export async function processJobs(
  workerId: string,
  max = 10,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < max; i += 1) {
    const job = await claimNextJob(workerId);
    if (!job) break;

    processed += 1;

    try {
      await runJob(job);
      await completeJob(job.id);
      succeeded += 1;
    } catch (error) {
      // A missing provider is a configuration state, not a code fault. It is
      // still a failure for this job, but it retries rather than dying.
      if (error instanceof ProviderUnavailableError) {
        logger.warn('Job deferred: no AI provider configured', { jobId: job.id });
      }
      await failJob(job.id, error);
      failed += 1;
    }
  }

  // Housekeeping on the same schedule. Expiring lapsed subscriptions here is
  // what stops a CANCELLED plan granting access forever on the strength of a
  // currentPeriodEnd nothing re-reads. Failures are swallowed: housekeeping
  // must never fail the job cycle.
  await pruneRateLimitCounters().catch(() => undefined);
  await expireLapsedSubscriptions().catch(() => undefined);

  return { processed, succeeded, failed };
}
