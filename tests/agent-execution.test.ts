import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  createTestUser,
  clearProviderKeys,
  giveTestSubscription,
  provisionAgents,
  resetDatabase,
  setProviderKey,
} from './helpers';
import {
  executeAgent,
  ProviderUnavailableError,
} from '@/lib/agent-execution';
import { setManualOverride } from '@/lib/ai/policies';

/**
 * The three execution outcomes plus the unconfigured case.
 *
 * `runAgentDecision` is stubbed because the assertions here are about the
 * pipeline — policy ordering, the approval gate, what gets recorded — not
 * about a provider's output. Making real model calls would make the suite
 * slow, non-deterministic and dependent on a credential.
 */
vi.mock('@/lib/ai/decision', () => ({
  runAgentDecision: vi.fn(async () => ({
    decision: 'Proceed',
    recommendedAction: 'Send an introduction email',
    riskLevel: 'medium' as const,
    confidence: 0.9,
    requiresHumanApproval: false,
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

describe('agent execution', () => {
  it('blocks a forbidden objective and records the run', async () => {
    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    const result = await executeAgent({
      userId: user.id,
      actor: user.email,
      agentId: 'SALES',
      objective: 'transfer ownership of the company to another party',
    });

    expect(result.status).toBe('blocked');

    const run = await prisma.agentRun.findFirst({ where: { userId: user.id } });
    expect(run?.blocked).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, type: 'policy_blocked' },
    });
    expect(audit).not.toBeNull();
  });

  it('blocks a forbidden objective even with no provider configured', async () => {
    // The regression this guards: an unconfigured install used to answer 503
    // "no AI provider" to a request that must always be a policy refusal.
    clearProviderKeys();

    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    const result = await executeAgent({
      userId: user.id,
      actor: user.email,
      agentId: 'SALES',
      objective: 'نقل الملكية إلى طرف آخر',
    });

    expect(result.status).toBe('blocked');
  });

  it('raises ProviderUnavailableError for a legitimate objective with no provider', async () => {
    clearProviderKeys();

    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    await expect(
      executeAgent({
        userId: user.id,
        actor: user.email,
        agentId: 'SALES',
        objective: 'Draft an introduction email for a retail prospect',
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('creates a pending approval when policy requires one', async () => {
    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    // CEO carries a zero micro-budget, so its decisions always need a human.
    const result = await executeAgent({
      userId: user.id,
      actor: user.email,
      agentId: 'CEO',
      objective: 'Decide the pricing strategy for the next quarter',
    });

    expect(result.status).toBe('approval_required');

    const approval = await prisma.approval.findFirst({
      where: { userId: user.id },
    });

    expect(approval?.status).toBe('PENDING');
  });

  it('returns an autonomous result inside the agent budget', async () => {
    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    const result = await executeAgent({
      userId: user.id,
      actor: user.email,
      agentId: 'SALES',
      objective: 'Summarise this quarter of sales activity',
      amountUsd: 10,
    });

    expect(result.status).toBe('autonomous');
    expect(await prisma.approval.count({ where: { userId: user.id } })).toBe(0);
  });

  it('forces approval for every action while manual override is on', async () => {
    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    await setManualOverride(user.id, true, user.email);

    const result = await executeAgent({
      userId: user.id,
      actor: user.email,
      agentId: 'SALES',
      objective: 'Summarise this quarter of sales activity',
      amountUsd: 10,
    });

    expect(result.status).toBe('approval_required');
  });

  it('escalates to approval when the amount exceeds the agent budget', async () => {
    const user = await createTestUser();
    await provisionAgents(user.id);
    await giveTestSubscription(user.id);

    const result = await executeAgent({
      userId: user.id,
      actor: user.email,
      agentId: 'SALES',
      objective: 'Offer a discount to close this deal',
      amountUsd: 5000,
    });

    expect(result.status).toBe('approval_required');
  });
});
