import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  createTestUser,
  provisionAgents,
  giveTestSubscription,
  resetDatabase,
  setProviderKey,
} from './helpers';
import { createLead, DuplicateLeadError, updateLead } from '@/lib/leads';
import { executeAgent } from '@/lib/agent-execution';
import { enqueueJob } from '@/lib/jobs';
import {
  createTriggerSchema,
  evaluateTrigger,
  processJobs,
  renderObjective,
} from '@/lib/automation';
import { validateModelSelection } from '@/lib/ai/models';
import { __setDiscoveryProvider } from '@/lib/discovery';
import type {
  DiscoveredBusiness,
  DiscoveryProvider,
} from '@/lib/discovery/provider';

/** Substitutes the directory call; everything downstream of it runs for real. */
class FakeDiscoveryProvider implements DiscoveryProvider {
  readonly name = 'google_places';
  isConfigured(): boolean {
    return true;
  }
  async search(): Promise<DiscoveredBusiness[]> {
    return [{ externalId: 'places/AAA', name: 'Riyadh Dental Centre' }];
  }
}

vi.mock('@/lib/ai/decision', () => ({
  runAgentDecision: vi.fn(async () => ({
    decision: 'Proceed',
    recommendedAction: 'Send an introduction email',
    riskLevel: 'medium' as const,
    confidence: 0.9,
    requiresHumanApproval: true,
    rationaleSummary: 'Warm prospect',
    expectedBusinessImpact: 'Opens the pipeline',
    suggestedNextStep: 'Await a reply',
    modelUsed: 'gpt-4o',
  })),
  AgentDecisionError: class extends Error {},
}));

beforeEach(async () => {
  await resetDatabase();
  setProviderKey();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('lead workflow', () => {
  it('creates a lead and records the activity', async () => {
    const user = await createTestUser();

    const lead = await createLead({
      userId: user.id,
      actor: user.email,
      companyName: 'Acme Retail',
      email: 'buyer@acme.test',
    });

    expect(lead.status).toBe('NEW');

    const activity = await prisma.activity.findFirst({
      where: { leadId: lead.id, type: 'lead_created' },
    });
    expect(activity).not.toBeNull();
  });

  it('rejects a duplicate email within the same account', async () => {
    const user = await createTestUser();

    await createLead({
      userId: user.id,
      actor: user.email,
      companyName: 'Acme',
      email: 'buyer@acme.test',
    });

    await expect(
      createLead({
        userId: user.id,
        actor: user.email,
        companyName: 'Acme again',
        email: 'buyer@acme.test',
      }),
    ).rejects.toBeInstanceOf(DuplicateLeadError);
  });

  it('allows the same email in a different account', async () => {
    const first = await createTestUser();
    const second = await createTestUser();

    await createLead({
      userId: first.id,
      actor: first.email,
      companyName: 'Acme',
      email: 'buyer@acme.test',
    });

    const other = await createLead({
      userId: second.id,
      actor: second.email,
      companyName: 'Acme',
      email: 'buyer@acme.test',
    });

    expect(other.id).toBeTruthy();
  });

  it('logs a status change distinctly from a field edit', async () => {
    const user = await createTestUser();

    const lead = await createLead({
      userId: user.id,
      actor: user.email,
      companyName: 'Acme',
    });

    await updateLead(lead.id, user.id, { status: 'QUALIFIED' }, user.email);
    await updateLead(lead.id, user.id, { notes: 'Called them' }, user.email);

    const types = (
      await prisma.activity.findMany({ where: { leadId: lead.id } })
    ).map((a) => a.type);

    expect(types).toContain('status_changed');
    expect(types).toContain('lead_updated');
  });

  it('runs an agent against a lead and links the approval to it', async () => {
    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    const lead = await createLead({
      userId: user.id,
      actor: user.email,
      companyName: 'Acme Retail',
      email: 'buyer@acme.test',
    });

    const result = await executeAgent({
      userId: user.id,
      actor: user.email,
      agentId: 'SALES',
      objective: 'Draft an introduction email for this prospect',
      leadId: lead.id,
      recipient: lead.email ?? undefined,
    });

    expect(result.status).toBe('approval_required');

    const approval = await prisma.approval.findFirst({
      where: { userId: user.id },
    });
    expect(approval?.leadId).toBe(lead.id);

    const run = await prisma.agentRun.findFirst({ where: { userId: user.id } });
    expect(run?.leadId).toBe(lead.id);

    const activity = await prisma.activity.findFirst({
      where: { leadId: lead.id, type: 'approval_created' },
    });
    expect(activity).not.toBeNull();
  });
});

describe('automation', () => {
  it('substitutes lead fields into an objective template', () => {
    expect(
      renderObjective('Write to {{company}} about {{status}}', {
        companyName: 'Acme',
        contactName: null,
        status: 'NEW',
      }),
    ).toBe('Write to Acme about NEW');
  });

  it('drops a duplicate job with the same idempotency key', async () => {
    const user = await createTestUser();

    const first = await enqueueJob({
      userId: user.id,
      kind: 'lead_agent_action',
      payload: { leadId: 'x', agentType: 'SALES', objective: 'hello there' },
      idempotencyKey: 'same-key',
    });

    const second = await enqueueJob({
      userId: user.id,
      kind: 'lead_agent_action',
      payload: { leadId: 'x', agentType: 'SALES', objective: 'hello there' },
      idempotencyKey: 'same-key',
    });

    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(await prisma.job.count({ where: { userId: user.id } })).toBe(1);
  });

  it('drains only the account it was scoped to', async () => {
    // The session-driven worker path passes the caller's own id. Without it a
    // signed-in operator's manual run executes whatever sits at the head of the
    // global queue — spending someone else's model budget and filing approvals
    // in their name. Both jobs name a lead that does not exist, so each ends
    // immediately and the assertion is about *which* one was claimed.
    const mine = await createTestUser();
    const theirs = await createTestUser();

    for (const owner of [mine, theirs]) {
      await enqueueJob({
        userId: owner.id,
        kind: 'lead_agent_action',
        payload: { leadId: 'gone', agentType: 'SALES', objective: 'hello there' },
      });
    }

    const drained = await processJobs('scoped-worker', 5, mine.id);

    expect(drained.processed).toBe(1);
    expect(
      (await prisma.job.findFirst({ where: { userId: theirs.id } }))?.status,
    ).toBe('PENDING');
  });

  it('drives a trigger through the queue into a real approval', async () => {
    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    const lead = await createLead({
      userId: user.id,
      actor: user.email,
      companyName: 'Acme Retail',
      email: 'buyer@acme.test',
    });

    const trigger = await prisma.automationTrigger.create({
      data: {
        userId: user.id,
        name: 'Contact new leads',
        kind: 'lead_status',
        leadStatus: 'NEW',
        agentType: 'SALES',
        objectiveTemplate: 'Write a first outreach email to {{company}}',
        enabled: true,
      },
    });

    const evaluation = await evaluateTrigger(trigger.id);
    expect(evaluation.enqueued).toBe(1);

    // Re-evaluating the same day must not queue the action twice.
    const again = await evaluateTrigger(trigger.id);
    expect(again.enqueued).toBe(0);
    expect(again.skipped).toBe(1);

    const drained = await processJobs('test-worker', 5);
    expect(drained.processed).toBe(1);
    expect(drained.succeeded).toBe(1);

    // The automated run produced a pending approval — not a sent message.
    const approval = await prisma.approval.findFirst({
      where: { userId: user.id, leadId: lead.id },
    });
    expect(approval?.status).toBe('PENDING');

    const run = await prisma.agentRun.findFirst({
      where: { userId: user.id, leadId: lead.id },
    });
    expect(run?.jobId).toBeTruthy();
  });

  it('drives a discovery trigger into imported leads', async () => {
    const user = await createTestUser();
    await giveTestSubscription(user.id);
    __setDiscoveryProvider(new FakeDiscoveryProvider());

    const trigger = await prisma.automationTrigger.create({
      data: {
        userId: user.id,
        name: 'Find dental clinics',
        kind: 'discovery',
        agentType: 'DISCOVERY',
        objectiveTemplate: 'dental clinic @ Riyadh',
        enabled: true,
      },
    });

    const evaluation = await evaluateTrigger(trigger.id);
    expect(evaluation.enqueued).toBe(1);

    const drained = await processJobs('test-worker', 5);
    expect(drained.succeeded).toBe(1);

    const leads = await prisma.lead.findMany({ where: { userId: user.id } });
    expect(leads).toHaveLength(1);
    expect(leads[0].externalSource).toBe('google_places');

    __setDiscoveryProvider(null);
  });

  it('scans once per day however often the cron evaluates the trigger', async () => {
    // The cron runs every five minutes. Without the (trigger, day) idempotency
    // key that would be 288 metered calls to a paid external directory.
    const user = await createTestUser();
    await giveTestSubscription(user.id);
    __setDiscoveryProvider(new FakeDiscoveryProvider());

    const trigger = await prisma.automationTrigger.create({
      data: {
        userId: user.id,
        name: 'Find dental clinics',
        kind: 'discovery',
        agentType: 'DISCOVERY',
        objectiveTemplate: 'dental clinic @ Riyadh',
        enabled: true,
        cooldownHours: 0,
      },
    });

    await evaluateTrigger(trigger.id);
    const again = await evaluateTrigger(trigger.id);

    expect(again.enqueued).toBe(0);
    expect(await prisma.job.count({ where: { userId: user.id } })).toBe(1);

    __setDiscoveryProvider(null);
  });

  it('leaves a lead_status trigger on its original path', async () => {
    // evaluateTrigger now branches on `kind`. Everything that is not
    // 'discovery' must behave exactly as before, including a trigger whose
    // kind was never one of the handled values.
    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    await createLead({
      userId: user.id,
      actor: user.email,
      companyName: 'Acme Retail',
      email: 'buyer@acme.test',
    });

    const trigger = await prisma.automationTrigger.create({
      data: {
        userId: user.id,
        name: 'Contact new leads',
        kind: 'lead_status',
        leadStatus: 'NEW',
        agentType: 'SALES',
        objectiveTemplate: 'Write a first outreach email to {{company}}',
        enabled: true,
      },
    });

    const evaluation = await evaluateTrigger(trigger.id);

    expect(evaluation.matched).toBe(1);
    expect(evaluation.enqueued).toBe(1);

    const job = await prisma.job.findFirstOrThrow({ where: { userId: user.id } });
    expect(job.kind).toBe('lead_agent_action');
  });

  it('does not run a disabled trigger', async () => {
    const user = await createTestUser();

    const trigger = await prisma.automationTrigger.create({
      data: {
        userId: user.id,
        name: 'Disabled',
        kind: 'lead_status',
        agentType: 'SALES',
        objectiveTemplate: 'Write to {{company}}',
        enabled: false,
      },
    });

    const evaluation = await evaluateTrigger(trigger.id);
    expect(evaluation.enqueued).toBe(0);
  });
});

/**
 * The trigger a customer can actually create.
 *
 * The discovery path above builds its trigger with a direct `prisma.create`,
 * which is exactly how it stayed reachable in tests while being unreachable in
 * the product: the API accepted one kind and the UI hardcoded it. These assert
 * against the schema the route parses, so the two cannot drift apart again.
 */
describe('creating a trigger', () => {
  it('accepts a discovery trigger with a parseable search', () => {
    const parsed = createTriggerSchema.parse({
      kind: 'discovery',
      name: 'عيادات الرياض',
      search: 'عيادة أسنان @ الرياض',
    });

    expect(parsed).toMatchObject({ kind: 'discovery', cooldownHours: 24 });
  });

  it('refuses a search with no location', () => {
    const result = createTriggerSchema.safeParse({
      kind: 'discovery',
      name: 'عيادات',
      search: 'عيادة أسنان',
    });

    expect(result.success).toBe(false);
  });

  it('still accepts the old body that omits kind', () => {
    const parsed = createTriggerSchema.parse({
      name: 'Follow up',
      agentType: 'SALES',
      objectiveTemplate: 'Write to {{company}}',
    });

    expect(parsed.kind).toBe('lead_status');
  });

  it('refuses a lead trigger naming an agent that does not exist', () => {
    const result = createTriggerSchema.safeParse({
      kind: 'lead_status',
      name: 'Follow up',
      agentType: 'NOT_AN_AGENT',
      objectiveTemplate: 'Write to {{company}}',
    });

    expect(result.success).toBe(false);
  });
});

describe('model validation', () => {
  it('rejects an unknown model id', () => {
    const result = validateModelSelection('definitely-not-a-model');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Unknown model');
  });

  it('rejects a known model whose provider has no key', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = validateModelSelection('claude-sonnet-4-5');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('anthropic');
  });

  it('accepts a known model with its provider configured', () => {
    setProviderKey();
    expect(validateModelSelection('gpt-4o').ok).toBe(true);
  });
});
