import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTestUser, resetDatabase } from './helpers';
import {
  approveApproval,
  ApprovalNotFoundError,
  ApprovalStateError,
  createApproval,
  dispatchApproval,
  rejectApproval,
} from '@/lib/approvals';
import { createLead, getLead, LeadNotFoundError, updateLead } from '@/lib/leads';

/**
 * Tenant isolation and the approval state machine.
 *
 * These are the two places where a silent regression is most expensive: one
 * leaks another account's data, the other could put a message on the wire
 * without a human decision.
 */
const DECISION = {
  decision: 'Proceed',
  recommendedAction: 'Send an introduction email',
  riskLevel: 'medium' as const,
  confidence: 0.9,
  requiresHumanApproval: true,
  rationaleSummary: 'Warm prospect',
  expectedBusinessImpact: 'Opens the pipeline',
  suggestedNextStep: 'Await a reply',
};

beforeEach(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('cross-account access', () => {
  it('hides another account\'s lead behind a not-found error', async () => {
    const owner = await createTestUser();
    const other = await createTestUser();

    const lead = await createLead({
      userId: owner.id,
      actor: owner.email,
      companyName: 'Acme',
      email: 'acme@example.test',
    });

    await expect(getLead(lead.id, other.id)).rejects.toBeInstanceOf(
      LeadNotFoundError,
    );

    await expect(
      updateLead(lead.id, other.id, { status: 'WON' }, other.email),
    ).rejects.toBeInstanceOf(LeadNotFoundError);

    // The owner's record is untouched by the failed attempt.
    const stillOwned = await getLead(lead.id, owner.id);
    expect(stillOwned.status).toBe('NEW');
  });

  it('refuses to let another account act on an approval', async () => {
    const owner = await createTestUser();
    const other = await createTestUser();

    const approval = await createApproval({
      userId: owner.id,
      agentId: 'SALES',
      objective: 'Send an introduction email',
      decision: DECISION,
    });

    await expect(
      approveApproval(approval.id, other.id, other.email),
    ).rejects.toBeInstanceOf(ApprovalNotFoundError);

    const unchanged = await prisma.approval.findUnique({
      where: { id: approval.id },
    });
    expect(unchanged?.status).toBe('PENDING');
  });

  it('scopes conversations to their owner', async () => {
    const owner = await createTestUser();
    const other = await createTestUser();

    const conversation = await prisma.conversation.create({
      data: { userId: owner.id, title: 'Private thread', isActive: true },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        content: 'sensitive content',
        role: 'user',
      },
    });

    // Mirrors the route's query: both id and userId must match.
    const asOther = await prisma.conversation.findFirst({
      where: { id: conversation.id, userId: other.id },
    });
    expect(asOther).toBeNull();

    const asOwner = await prisma.conversation.findFirst({
      where: { id: conversation.id, userId: owner.id },
    });
    expect(asOwner).not.toBeNull();
  });
});

describe('approval state machine', () => {
  it('refuses to dispatch an item that is still pending', async () => {
    const user = await createTestUser();

    const approval = await createApproval({
      userId: user.id,
      agentId: 'SALES',
      objective: 'Send an introduction email',
      decision: DECISION,
      recipient: 'lead@example.test',
    });

    await expect(
      dispatchApproval(approval.id, user.id, user.email),
    ).rejects.toBeInstanceOf(ApprovalStateError);
  });

  it('marks an approved item FAILED rather than SENT with no transport', async () => {
    const user = await createTestUser();

    const approval = await createApproval({
      userId: user.id,
      agentId: 'SALES',
      objective: 'Send an introduction email',
      decision: DECISION,
      recipient: 'lead@example.test',
    });

    await approveApproval(approval.id, user.id, user.email);
    const dispatched = await dispatchApproval(approval.id, user.id, user.email);

    // The property that matters: an undeliverable message is never recorded
    // as sent.
    expect(dispatched.status).toBe('FAILED');
    expect(dispatched.failureReason).toContain('transport');
  });

  it('does not allow a rejected item to be approved', async () => {
    const user = await createTestUser();

    const approval = await createApproval({
      userId: user.id,
      agentId: 'SALES',
      objective: 'Send an introduction email',
      decision: DECISION,
    });

    await rejectApproval(approval.id, user.id, user.email);

    await expect(
      approveApproval(approval.id, user.id, user.email),
    ).rejects.toBeInstanceOf(ApprovalStateError);
  });

  it('writes an audit row for every transition', async () => {
    const user = await createTestUser();

    const approval = await createApproval({
      userId: user.id,
      agentId: 'SALES',
      objective: 'Send an introduction email',
      decision: DECISION,
    });

    await approveApproval(approval.id, user.id, user.email);

    const logs = await prisma.auditLog.findMany({
      where: { approvalId: approval.id },
    });

    expect(logs.map((l) => l.type)).toEqual(
      expect.arrayContaining(['approval_created', 'approval_updated']),
    );
    expect(logs.every((l) => l.actor === null || l.actor === user.email)).toBe(
      true,
    );
  });
});

describe('admin gate', () => {
  const ORIGINAL = process.env.ADMIN_EMAILS;
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = ORIGINAL;
  });

  it('denies everyone when ADMIN_EMAILS is unset', async () => {
    delete process.env.ADMIN_EMAILS;
    vi.resetModules();
    const { isAdminEmail } = await import('@/lib/auth/admin');
    expect(isAdminEmail('owner@example.test')).toBe(false);
  });

  it('admits only listed addresses, case-insensitively', async () => {
    process.env.ADMIN_EMAILS = ' Owner@Example.test , second@example.test ';
    vi.resetModules();
    const { isAdminEmail } = await import('@/lib/auth/admin');
    expect(isAdminEmail('owner@example.test')).toBe(true);
    expect(isAdminEmail('SECOND@example.test')).toBe(true);
    expect(isAdminEmail('someone@example.test')).toBe(false);
  });

  it('does not admit on a partial or substring match', async () => {
    process.env.ADMIN_EMAILS = 'owner@example.test';
    vi.resetModules();
    const { isAdminEmail } = await import('@/lib/auth/admin');
    expect(isAdminEmail('owner@example.test.evil.com')).toBe(false);
    expect(isAdminEmail('not-owner@example.test')).toBe(false);
  });
});
