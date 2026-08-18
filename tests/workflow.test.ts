import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  createTestUser,
  provisionAgents,
  resetDatabase,
  setProviderKey,
} from './helpers';
import { createLead, DuplicateLeadError, updateLead } from '@/lib/leads';
import { executeAgent } from '@/lib/agent-execution';
import { enqueueJob } from '@/lib/jobs';
import { evaluateTrigger, processJobs, renderObjective } from '@/lib/automation';
import { validateModelSelection } from '@/lib/ai/models';

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

  it('drives a trigger through the queue into a real approval', async () => {
    const user = await createTestUser();
    await provisionAgents(user.id);

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
