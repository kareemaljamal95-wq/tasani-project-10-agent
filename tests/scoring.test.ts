import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTestUser, resetDatabase } from './helpers';
import { createLead, updateLead } from '@/lib/leads';
import {
  scoreLead,
  gradeFor,
  affectsScore,
  GRADE_THRESHOLDS,
} from '@/lib/lead-scoring';
import { evaluatePolicy } from '@/lib/ai/policies';
import { AGENT_DEFAULTS } from '@/lib/ai/agent-defaults';

beforeEach(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('scoreLead', () => {
  it('scores a business with nothing published at zero, and says so', () => {
    // The honest floor. A lead we know nothing about must not inherit a
    // flattering default — an unexamined prospect is not an opportunity.
    const result = scoreLead({});

    expect(result.score).toBe(0);
    expect(result.grade).toBe('C');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('treats a missing website as the largest single opportunity', () => {
    const withSite = scoreLead({ website: 'https://example.test', phone: '+966' });
    const without = scoreLead({ website: null, phone: '+966' });

    expect(without.score).toBeGreaterThan(withSite.score);
    expect(without.reasons.some((r) => r.includes('لا يوجد موقع'))).toBe(true);
  });

  it('never exceeds 100 on the strongest possible signal set', () => {
    const best = scoreLead({
      website: null,
      phone: '+966 11 000 0001',
      email: 'a@example.test',
      rating: 3.2,
      ratingCount: 500,
    });

    expect(best.score).toBeLessThanOrEqual(100);
    expect(best.score).toBe(100);
    expect(best.grade).toBe('A');
  });

  it('does not count an absent rating as a bad rating', () => {
    // Absence of data is not evidence. A business the source published no
    // rating for must score the same as if the field were simply skipped.
    const absent = scoreLead({ phone: '+966', rating: null, ratingCount: null });
    const undef = scoreLead({ phone: '+966' });

    expect(absent.score).toBe(undef.score);
  });

  it('treats whitespace as absence, not as a value', () => {
    expect(scoreLead({ website: '   ' }).score).toBe(scoreLead({}).score);
  });

  it('scores a reachable lead above an unreachable one', () => {
    const reachable = scoreLead({ phone: '+966 11 000 0001' });
    const unreachable = scoreLead({});

    expect(reachable.score).toBeGreaterThan(unreachable.score);
  });

  it('gives every point a stated reason', () => {
    const result = scoreLead({
      website: null,
      phone: '+966',
      rating: 4.8,
      ratingCount: 120,
    });

    // Four signals are read, so four lines are shown. A number with fewer
    // reasons than inputs would be partly unexplained.
    expect(result.reasons).toHaveLength(4);
  });
});

describe('gradeFor', () => {
  it('grades on the published thresholds, inclusive at the boundary', () => {
    expect(gradeFor(GRADE_THRESHOLDS.A)).toBe('A');
    expect(gradeFor(GRADE_THRESHOLDS.A - 1)).toBe('B');
    expect(gradeFor(GRADE_THRESHOLDS.B)).toBe('B');
    expect(gradeFor(GRADE_THRESHOLDS.B - 1)).toBe('C');
  });

  it('agrees with the grade scoreLead returns', () => {
    const result = scoreLead({ website: null, phone: '+966', ratingCount: 300 });
    expect(result.grade).toBe(gradeFor(result.score));
  });
});

describe('affectsScore', () => {
  it('is true for a scoring input and false for an unrelated edit', () => {
    expect(affectsScore({ website: null })).toBe(true);
    expect(affectsScore({ rating: 4.1 })).toBe(true);
    expect(affectsScore({})).toBe(false);
  });
});

describe('lead persistence', () => {
  it('scores a lead on creation rather than storing a placeholder', async () => {
    const user = await createTestUser();

    const lead = await createLead({
      userId: user.id,
      actor: 'test',
      companyName: 'Smile Clinic',
      phone: '+966 11 000 0002',
      rating: 3.5,
      ratingCount: 60,
    });

    expect(lead.score).toBe(
      scoreLead({ phone: '+966 11 000 0002', rating: 3.5, ratingCount: 60 })
        .score,
    );
    expect(lead.rating).toBe(3.5);
    expect(lead.ratingCount).toBe(60);
  });

  it('lets an explicit score override the derived one', async () => {
    const user = await createTestUser();

    const lead = await createLead({
      userId: user.id,
      actor: 'test',
      companyName: 'Manual Co',
      score: 88,
    });

    expect(lead.score).toBe(88);
  });

  it('rescores when an edit closes the gap it was scored on', async () => {
    const user = await createTestUser();

    const lead = await createLead({
      userId: user.id,
      actor: 'test',
      companyName: 'No Site Co',
      phone: '+966 11 000 0003',
      ratingCount: 150,
    });

    const updated = await updateLead(
      lead.id,
      user.id,
      { website: 'https://nosite.test' },
      'test',
    );

    // Gaining a website removes the largest component, so the lead must stop
    // being reported as the opportunity it no longer is.
    expect(updated.website).toBe('https://nosite.test');
    expect(updated.score).toBeLessThan(lead.score);
  });

  it('leaves the score alone on an edit that reads none of its inputs', async () => {
    const user = await createTestUser();

    const lead = await createLead({
      userId: user.id,
      actor: 'test',
      companyName: 'Steady Co',
      phone: '+966 11 000 0004',
    });

    const updated = await updateLead(
      lead.id,
      user.id,
      { notes: 'called, will follow up' },
      'test',
    );

    expect(updated.score).toBe(lead.score);
  });
});

describe('STRATEGIST agent', () => {
  it('is provisioned in the default workforce', () => {
    expect(AGENT_DEFAULTS.some((a) => a.type === 'STRATEGIST')).toBe(true);
  });

  it('is not blocked as an unknown agent', async () => {
    // An agent type absent from MICRO_BUDGET_USD is refused outright, so it
    // would be listed in the UI and dead on click. This asserts the pair.
    const user = await createTestUser();

    const result = await evaluatePolicy({
      userId: user.id,
      agentId: 'STRATEGIST',
      objective: 'Recommend which service to lead with for this prospect',
    });

    expect(result.blocked).toBe(false);
    expect(result.reason ?? '').not.toContain('Unknown agent');
  });

  it('still refuses a forbidden objective', async () => {
    const user = await createTestUser();

    const result = await evaluatePolicy({
      userId: user.id,
      agentId: 'STRATEGIST',
      objective: 'transfer ownership of the company to another party',
    });

    expect(result.blocked).toBe(true);
  });
});
