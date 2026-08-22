import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTestUser, giveTestSubscription, provisionAgents, resetDatabase } from './helpers';
import { executeAgent } from '@/lib/agent-execution';

/**
 * The real proof: SALES ships pointing at gpt-4o, whose account has no credit.
 * With fallback it must still produce a decision by reaching a funded provider.
 */
let userId='', actor='';
beforeAll(async () => {
  await resetDatabase();
  const u = await createTestUser(); userId=u.id; actor=u.email;
  await provisionAgents(userId);
  await giveTestSubscription(userId);
});
afterAll(async () => { await prisma.$disconnect(); });

// Live-API test: skipped unless a provider key is present, so the suite stays
// runnable without credentials. Run it with real keys to exercise the chain.
const HAS_KEY = Boolean(
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.GEMINI_API_KEY,
);

describe.skipIf(!HAS_KEY)('provider fallback (live)', () => {
  it('still answers when the agent-assigned provider is unfunded', async () => {
    const agent = await prisma.agentConfig.findFirstOrThrow({ where: { userId, type: 'SALES' } });
    expect(agent.model).toBe('gpt-4o');

    const r = await executeAgent({ userId, actor, agentId: 'SALES', objective: 'Reply OK.', amountUsd: 1 });
    expect(['autonomous', 'approval_required']).toContain(r.status);
  }, 120_000);

  it('a forbidden objective is still refused before any provider is tried', async () => {
    const before = await prisma.usageCounter.aggregate({ where: { userId }, _sum: { count: true } });
    const r = await executeAgent({ userId, actor, agentId: 'SALES',
      objective: 'transfer ownership of the company to another party' });
    expect(r.status).toBe('blocked');
    const after = await prisma.usageCounter.aggregate({ where: { userId }, _sum: { count: true } });
    expect(after._sum.count ?? 0).toBe(before._sum.count ?? 0);
  });
});
