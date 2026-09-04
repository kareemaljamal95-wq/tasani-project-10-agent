import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LeadStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createTestUser, giveTestSubscription, resetDatabase } from './helpers';
import { createLead } from '@/lib/leads';
import { performAgentAction, isPermitted, permittedActions } from '@/lib/ai/actions';

/**
 * Agent actions.
 *
 * The assertions that matter are the refusals. An agent that can do work is
 * only safe while the boundary around that work is exact: its own role, its
 * own account, and nothing that reaches an outside party.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('performing an agent action', () => {
  it('builds a real site rather than describing one', async () => {
    const user = await createTestUser();
    await giveTestSubscription(user.id);

    const result = await performAgentAction({
      userId: user.id,
      agentId: 'CONTENT',
      actor: 'agent',
      action: {
        kind: 'build_site',
        raw: 'مطعم الواحة\nمطعم\n+966 11 456 7890\n- مندي لحم 85 ر.س',
      },
    });

    expect(result.performed).toBe(true);

    // The proof is the row, not the return value.
    const site = await prisma.generatedSite.findFirst({ where: { userId: user.id } });
    expect(site?.name).toBe('مطعم الواحة');
    expect(site?.html).toContain('مندي لحم');
  });

  it('moves a lead along the funnel', async () => {
    const user = await createTestUser();
    const lead = await createLead({
      userId: user.id,
      actor: user.email,
      companyName: 'Acme Retail',
      source: 'manual',
    });

    const result = await performAgentAction({
      userId: user.id,
      agentId: 'SALES',
      actor: 'agent',
      action: {
        kind: 'set_lead_status',
        leadId: lead.id,
        status: LeadStatus.CONTACTED,
      },
    });

    expect(result.performed).toBe(true);
    expect(
      (await prisma.lead.findUnique({ where: { id: lead.id } }))?.status,
    ).toBe(LeadStatus.CONTACTED);
  });

  it('refuses an action outside the agent\'s role', async () => {
    const user = await createTestUser();
    await giveTestSubscription(user.id);

    // A content agent has no business moving leads, whatever it decides.
    const result = await performAgentAction({
      userId: user.id,
      agentId: 'CONTENT',
      actor: 'agent',
      action: { kind: 'set_lead_status', leadId: 'x', status: LeadStatus.WON },
    });

    expect(result).toMatchObject({ performed: false, reason: 'not-permitted' });

    // The refusal is recorded, not silently dropped.
    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, type: 'agent_action_refused' },
    });
    expect(audit).toBeTruthy();
  });

  it('cannot touch another account\'s lead', async () => {
    const mine = await createTestUser();
    const theirs = await createTestUser();

    const lead = await createLead({
      userId: theirs.id,
      actor: theirs.email,
      companyName: 'Not Mine',
      source: 'manual',
    });

    const result = await performAgentAction({
      userId: mine.id,
      agentId: 'SALES',
      actor: 'agent',
      action: { kind: 'set_lead_status', leadId: lead.id, status: LeadStatus.WON },
    });

    // Scoped inside updateLead: a lead from another account reads as
    // not-found, so this reports a failure and writes nothing.
    expect(result.performed).toBe(false);
    expect(
      (await prisma.lead.findUnique({ where: { id: lead.id } }))?.status,
    ).toBe(LeadStatus.NEW);
  });

  it('reports a failure instead of throwing away the decision', async () => {
    const user = await createTestUser();
    // No subscription: buildSite refuses on entitlement.

    const result = await performAgentAction({
      userId: user.id,
      agentId: 'CONTENT',
      actor: 'agent',
      action: { kind: 'build_site', raw: 'مطعم الواحة\nمطعم' },
    });

    // An action that cannot run must not take the run down with it — the
    // owner still needs to read what the agent concluded.
    expect(result).toMatchObject({ performed: false, reason: 'failed' });
    expect(await prisma.generatedSite.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does nothing when the agent proposes nothing', async () => {
    const user = await createTestUser();

    expect(
      await performAgentAction({
        userId: user.id,
        agentId: 'SALES',
        actor: 'agent',
        action: { kind: 'none' },
      }),
    ).toEqual({ performed: false, reason: 'none' });
  });
});

describe('the action boundary', () => {
  it('grants no action to an agent that declares none', async () => {
    // The safe direction to fail in: an agent type absent from the allowlist
    // can do nothing at all, so adding one never grants a capability by
    // omission.
    expect(permittedActions('CEO')).toEqual([]);
    expect(permittedActions('NOT_AN_AGENT')).toEqual([]);
    expect(isPermitted('CEO', 'build_site')).toBe(false);
  });

  it('lets every agent decline to act', async () => {
    for (const agent of ['CEO', 'FINANCE', 'CONTENT', 'NOT_AN_AGENT']) {
      expect(isPermitted(agent, 'none')).toBe(true);
    }
  });

  it('exposes no action that reaches outside the account', () => {
    // The rule the whole file rests on. Anything outward-facing stays a
    // PENDING approval a human releases; if this list ever grows a send, the
    // approval gate has been bypassed.
    const everything = new Set(
      ['CONTENT', 'MARKETING', 'SALES', 'STRATEGIST', 'DISCOVERY', 'OPERATIONS']
        .flatMap(permittedActions),
    );

    expect([...everything].sort()).toEqual([
      'build_site',
      'discovery_scan',
      'set_lead_status',
    ]);
  });
});
