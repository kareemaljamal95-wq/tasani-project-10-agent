import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it } from 'vitest';
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

/**
 * Chain construction, without touching a network.
 *
 * These matter because the chain decides how many doomed calls a single agent
 * run makes. The defaults request `gpt-4o` and `claude-sonnet-4-5`, so on an
 * instance funded only for Gemini a chain that led with the requested model
 * paid a failed round trip on every request.
 */
describe('fallbackModels', () => {
  const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('omits a requested model whose provider holds no key', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const { fallbackModels } = await import('@/lib/ai/provider');

    const chain = fallbackModels('gpt-4o');

    expect(chain).not.toContain('gpt-4o');
    expect(chain[0]).toMatch(/^gemini/);
  });

  it('leads with the requested model when its provider is configured', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const { fallbackModels } = await import('@/lib/ai/provider');

    expect(fallbackModels('gpt-4o')[0]).toBe('gpt-4o');
  });

  it('returns nothing when no provider is configured', async () => {
    const { fallbackModels } = await import('@/lib/ai/provider');

    // An empty chain is the honest answer; generateAIResponse turns it into an
    // error naming the missing variables rather than a failed call.
    expect(fallbackModels('gpt-4o')).toEqual([]);
  });
});
