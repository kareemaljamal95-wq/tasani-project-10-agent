import { LeadStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AGENT_TYPES } from '@/lib/ai/agent-defaults';
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
import { runDiscoveryScan } from '@/lib/discovery/scan';
import {
  DiscoveryUnavailableError,
  DiscoveryProviderError,
} from '@/lib/discovery/provider';
import { EntitlementError } from '@/lib/billing/entitlements';
import { UsageLimitError } from '@/lib/billing/usage';
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

const discoveryScanPayload = z.object({
  /** "query @ location", e.g. "dental clinic @ Riyadh". */
  search: z.string().min(3),
});

/**
 * Splits a discovery trigger's search string into query and location.
 *
 * A trigger stores the search in `objectiveTemplate` rather than growing two
 * more nullable columns on AutomationTrigger for a single trigger kind.
 */
export function parseDiscoverySearch(
  search: string,
): { query: string; location: string } | null {
  const [query, ...rest] = search.split('@');
  const location = rest.join('@').trim();

  if (!query.trim() || !location) return null;

  return { query: query.trim(), location };
}

/**
 * What a client may send to create a trigger.
 *
 * It lives here rather than in the route because the two kinds are not two sets
 * of optional fields — they are two different things sharing a table, and the
 * union is what stops a discovery trigger being created with an agent that will
 * never run, or a lead trigger with a search nothing will read.
 */
const leadStatusTriggerSchema = z.object({
  kind: z.literal('lead_status'),
  name: z.string().min(1).max(120),
  leadStatus: z.nativeEnum(LeadStatus).optional(),
  agentType: z.enum(AGENT_TYPES as [string, ...string[]]),
  objectiveTemplate: z.string().min(5).max(2000),
  cooldownHours: z.number().int().min(1).max(24 * 30).default(24),
});

/**
 * A discovery trigger looks for businesses that are not leads yet, so it has no
 * lead status to filter on and no agent to run — `evaluateDiscoveryTrigger`
 * enqueues one scan for the whole account instead of one action per lead.
 *
 * The search is validated at creation rather than at execution. A trigger whose
 * search cannot be parsed will not fix itself on retry: the job would run every
 * cycle, log "unparseable" and end, and the customer would watch an automation
 * that appears to run and never produces anything.
 */
const discoveryTriggerSchema = z.object({
  kind: z.literal('discovery'),
  name: z.string().min(1).max(120),
  /** "query @ location", e.g. "dental clinic @ Riyadh". */
  search: z
    .string()
    .min(3)
    .max(2000)
    .refine((value) => parseDiscoverySearch(value) !== null, {
      message: 'اكتب البحث بالصيغة: استعلام @ مدينة',
    }),
  cooldownHours: z.number().int().min(1).max(24 * 30).default(24),
});

export const createTriggerSchema = z.preprocess(
  // `kind` used to be optional with a default. A discriminated union cannot
  // default its discriminator, so the old shape is filled in here and an
  // existing client that omits the field keeps working.
  (value) =>
    value && typeof value === 'object' && !('kind' in value)
      ? { ...value, kind: 'lead_status' }
      : value,
  z.discriminatedUnion('kind', [
    leadStatusTriggerSchema,
    discoveryTriggerSchema,
  ]),
);

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

  // `kind` was previously read but never acted on — every trigger ran the lead
  // scan regardless. It now selects the behaviour, and anything that is not
  // 'discovery' keeps the original path so existing customers' triggers are
  // unaffected.
  if (trigger.kind === 'discovery') {
    return evaluateDiscoveryTrigger(trigger);
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

/**
 * A discovery trigger enqueues one scan for the whole account rather than one
 * job per lead — it is looking for businesses that are not leads yet.
 *
 * The idempotency key pins a scan to (trigger, day), so a trigger evaluated
 * every five minutes by the cron scans once a day and not 288 times. That is
 * also what keeps a metered, paid external call from being driven by the
 * scheduler's frequency.
 */
async function evaluateDiscoveryTrigger(trigger: {
  id: string;
  userId: string;
  objectiveTemplate: string;
  cooldownHours: number;
  lastRunAt: Date | null;
}): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const cooldownBefore = new Date(
    Date.now() - trigger.cooldownHours * 60 * 60 * 1000,
  );

  if (trigger.lastRunAt && trigger.lastRunAt > cooldownBefore) {
    return { matched: 0, enqueued: 0, skipped: 1 };
  }

  const day = new Date().toISOString().slice(0, 10);

  const result = await enqueueJob({
    userId: trigger.userId,
    kind: 'discovery_scan',
    triggerId: trigger.id,
    idempotencyKey: `trigger:${trigger.id}:discovery:${day}`,
    // objectiveTemplate carries the search as "query @ location" for a
    // discovery trigger; the parse and its error live in runJob.
    payload: { search: trigger.objectiveTemplate },
  });

  await prisma.automationTrigger.update({
    where: { id: trigger.id },
    data: { lastRunAt: new Date() },
  });

  return {
    matched: 1,
    enqueued: result.enqueued ? 1 : 0,
    skipped: result.enqueued ? 0 : 1,
  };
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

/**
 * Runs one scheduled discovery scan.
 *
 * Four conditions end the job quietly rather than throwing, because each is a
 * standing state that will not resolve by retrying: no provider configured, a
 * plan without discovery, and an exhausted scan budget are all answers, not
 * faults. Throwing would burn the job's retries and then park it as FAILED
 * every single cycle. A provider error does throw — that one is transient and
 * is exactly what the backoff exists for.
 */
async function runDiscoveryJob(job: {
  id: string;
  userId: string;
  payload: unknown;
}): Promise<void> {
  const payload = discoveryScanPayload.parse(job.payload);
  const search = parseDiscoverySearch(payload.search);

  if (!search) {
    // A malformed trigger will not fix itself on retry.
    logger.warn('Discovery trigger has an unparseable search', {
      jobId: job.id,
    });
    return;
  }

  try {
    const result = await runDiscoveryScan({
      userId: job.userId,
      actor: 'automation',
      query: search.query,
      location: search.location,
    });

    logger.info('Scheduled discovery scan complete', {
      jobId: job.id,
      found: result.found,
      imported: result.imported,
    });
  } catch (error) {
    if (
      error instanceof DiscoveryUnavailableError ||
      error instanceof EntitlementError ||
      error instanceof UsageLimitError
    ) {
      logger.info('Skipping scheduled discovery scan', {
        jobId: job.id,
        reason: error.name,
      });
      return;
    }

    if (error instanceof DiscoveryProviderError) throw error;
    throw error;
  }
}

/** Runs one job's work. Throws on failure so the queue can retry it. */
async function runJob(job: {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
}): Promise<void> {
  if (job.kind === 'discovery_scan') {
    return runDiscoveryJob(job);
  }

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
 *
 * `userId` confines the drain to one account, and the session-driven path must
 * supply it — see `claimNextJob`. The scheduler leaves it undefined on purpose:
 * driving every account is what it exists for.
 */
export async function processJobs(
  workerId: string,
  max = 10,
  userId?: string,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < max; i += 1) {
    const job = await claimNextJob(workerId, userId);
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
