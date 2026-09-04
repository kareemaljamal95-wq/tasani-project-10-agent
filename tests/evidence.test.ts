import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTestUser, resetDatabase } from './helpers';
import { createLead } from '@/lib/leads';
import { gatherEvidence, AGENTS_WITH_EVIDENCE } from '@/lib/ai/evidence';
import { AGENT_DEFAULTS } from '@/lib/ai/agent-defaults';

/**
 * Agent evidence.
 *
 * Before this, every agent reasoned over its objective string and nothing
 * else — no access to the account it was advising. The tests that matter here
 * are the ones about *absence*: an empty account must say it is empty, in a
 * shape the model cannot mistake for a gap it should fill.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('gathering evidence', () => {
  it('states an empty account as zero rather than omitting it', async () => {
    const user = await createTestUser();

    const e = (await gatherEvidence('ANALYST', user.id)) as {
      accountData: {
        ticketsByStatus: Record<string, number>;
        deliverables: { total: number };
        automation: { jobs: Record<string, number> };
      };
    };

    // A missing key is an invitation to invent one. Every status is present
    // and every count is a real zero.
    expect(e.accountData.ticketsByStatus.NEW).toBe(0);
    expect(Object.keys(e.accountData.ticketsByStatus).length).toBeGreaterThan(3);
    expect(e.accountData.deliverables.total).toBe(0);
    expect(e.accountData.automation.jobs.PENDING).toBe(0);
  });

  it('reports the account\'s real leads', async () => {
    const user = await createTestUser();

    await createLead({
      userId: user.id,
      actor: user.email,
      companyName: 'Riyadh Dental Centre',
      source: 'manual',
      phone: '+966 11 456 7890',
      rating: 4.6,
      ratingCount: 312,
    });

    const e = (await gatherEvidence('SALES', user.id)) as {
      accountData: {
        topOpportunities: { company: string; hasWebsite: boolean; score: number }[];
      };
    };

    const top = e.accountData.topOpportunities[0];
    expect(top.company).toBe('Riyadh Dental Centre');
    // Scored by the deterministic scorer, not by the model.
    expect(top.hasWebsite).toBe(false);
    expect(top.score).toBeGreaterThan(0);
  });

  it('never reads another account', async () => {
    const mine = await createTestUser();
    const theirs = await createTestUser();

    await createLead({
      userId: theirs.id,
      actor: theirs.email,
      companyName: 'Not Mine',
      source: 'manual',
    });

    const e = (await gatherEvidence('SALES', mine.id)) as {
      accountData: { topOpportunities: unknown[] };
    };

    expect(e.accountData.topOpportunities).toHaveLength(0);
  });

  it('says there is no subscription rather than leaving the field out', async () => {
    const user = await createTestUser();

    const e = (await gatherEvidence('FINANCE', user.id)) as {
      accountData: { subscription: { plan: null; status: string; note?: string } };
    };

    expect(e.accountData.subscription.status).toBe('none');
    expect(e.accountData.subscription.note).toContain('no subscription');
  });

  it('gives an agent with no declared source an empty slice, not a failure', async () => {
    const user = await createTestUser();

    // Adding an agent type must never break by omission — it stays as blind
    // as every agent used to be until a source is declared for it.
    expect(await gatherEvidence('NOT_AN_AGENT', user.id)).toEqual({});
  });

  it('covers every agent the product ships', async () => {
    // Derived from AGENT_DEFAULTS rather than a hardcoded list, so a new agent
    // added without a source fails here instead of shipping blind.
    const shipped = AGENT_DEFAULTS.map((a) => a.type);
    const missing = shipped.filter((t) => !AGENTS_WITH_EVIDENCE.includes(t));

    expect(missing).toEqual([]);
  });
});
