import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createTestUser, provisionAgents, resetDatabase } from './helpers';
import {
  completePasswordReset,
  InvalidResetTokenError,
  requestPasswordReset,
} from '@/lib/auth/password-reset';
import {
  createSessionToken,
  verifySessionToken,
} from '@/lib/auth/session';
import { rateLimitShared, RateLimitError } from '@/lib/rate-limit';
import { getManualOverride, setManualOverride } from '@/lib/ai/policies';
import { AGENT_DEFAULTS } from '@/lib/ai/agent-defaults';

beforeEach(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('onboarding', () => {
  it('completes once and stays complete', async () => {
    const user = await createTestUser({ onboarded: false });

    const before = await prisma.user.findUnique({ where: { id: user.id } });
    expect(before?.onboardingCompletedAt).toBeNull();

    await prisma.user.update({
      where: { id: user.id },
      data: { onboardingCompletedAt: new Date(), onboardingStep: null },
    });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after?.onboardingCompletedAt).not.toBeNull();
    expect(after?.onboardingStep).toBeNull();
  });

  it('provisions agents idempotently', async () => {
    const user = await createTestUser();

    await provisionAgents(user.id);
    await provisionAgents(user.id);

    const count = await prisma.agentConfig.count({ where: { userId: user.id } });
    // @@unique([userId, type]) plus skipDuplicates: a resumable flow can call
    // this more than once without doubling the workforce.
    //
    // Counted against AGENT_DEFAULTS rather than a literal, so adding an agent
    // type does not fail a test that is about idempotency, not about size.
    expect(count).toBe(AGENT_DEFAULTS.length);
  });
});

describe('settings persistence', () => {
  it('persists profile changes', async () => {
    const user = await createTestUser();

    await prisma.user.update({
      where: { id: user.id },
      data: { name: 'Kareem', language: 'AR', timezone: 'Asia/Riyadh' },
    });

    const reloaded = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloaded?.name).toBe('Kareem');
    expect(reloaded?.language).toBe('AR');
    expect(reloaded?.timezone).toBe('Asia/Riyadh');
  });

  it('persists an agent enable/disable per account', async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    await provisionAgents(user.id);
    await provisionAgents(other.id);

    const agent = await prisma.agentConfig.findFirstOrThrow({
      where: { userId: user.id, type: 'SALES' },
    });

    await prisma.agentConfig.updateMany({
      where: { id: agent.id, userId: user.id },
      data: { isEnabled: false },
    });

    expect(
      (await prisma.agentConfig.findUnique({ where: { id: agent.id } }))
        ?.isEnabled,
    ).toBe(false);

    // The other account's identically-typed agent is unaffected.
    const otherAgent = await prisma.agentConfig.findFirstOrThrow({
      where: { userId: other.id, type: 'SALES' },
    });
    expect(otherAgent.isEnabled).toBe(true);
  });

  it('ignores an update aimed at another account\'s agent', async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    await provisionAgents(user.id);

    const agent = await prisma.agentConfig.findFirstOrThrow({
      where: { userId: user.id, type: 'SALES' },
    });

    const result = await prisma.agentConfig.updateMany({
      where: { id: agent.id, userId: other.id },
      data: { isEnabled: false },
    });

    expect(result.count).toBe(0);
  });

  it('persists the manual override switch', async () => {
    const user = await createTestUser();

    expect(await getManualOverride(user.id)).toBe(false);
    await setManualOverride(user.id, true, user.email);
    expect(await getManualOverride(user.id)).toBe(true);

    // Scoped per account, not global.
    const other = await createTestUser();
    expect(await getManualOverride(other.id)).toBe(false);
  });
});

describe('sessions', () => {
  it('round-trips a valid session token', async () => {
    const token = await createSessionToken({
      userId: 'user-123',
      email: 'a@example.test',
    });

    const payload = await verifySessionToken(token);
    expect(payload?.userId).toBe('user-123');
  });

  it('rejects a tampered token', async () => {
    const token = await createSessionToken({
      userId: 'user-123',
      email: 'a@example.test',
    });

    expect(await verifySessionToken(`${token}x`)).toBeNull();
    expect(await verifySessionToken('not-a-token')).toBeNull();
  });
});

describe('password reset', () => {
  it('issues a token that resets the password exactly once', async () => {
    const user = await createTestUser();

    const outcome = await requestPasswordReset(user.email);
    expect(outcome.accepted).toBe(true);
    expect(outcome.token).toBeTruthy();

    // Only the hash is stored — the raw token must not appear in the row.
    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.tokenHash).not.toBe(outcome.token);

    await completePasswordReset(outcome.token!, 'a-brand-new-password');

    // Replaying the same token fails.
    await expect(
      completePasswordReset(outcome.token!, 'another-password-xx'),
    ).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('reports success for an unknown address without creating a token', async () => {
    const outcome = await requestPasswordReset('nobody@example.test');

    // Same answer as a real address, so the endpoint cannot enumerate accounts.
    expect(outcome.accepted).toBe(true);
    expect(outcome.token).toBeUndefined();
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('rejects an expired token', async () => {
    const user = await createTestUser();
    const outcome = await requestPasswordReset(user.email);

    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      completePasswordReset(outcome.token!, 'a-brand-new-password'),
    ).rejects.toBeInstanceOf(InvalidResetTokenError);
  });
});

describe('shared rate limiting', () => {
  it('enforces a budget that persists outside process memory', async () => {
    const key = `test-limit-${Date.now()}`;

    await rateLimitShared(key, 3, 60_000);
    await rateLimitShared(key, 3, 60_000);
    await rateLimitShared(key, 3, 60_000);

    await expect(rateLimitShared(key, 3, 60_000)).rejects.toBeInstanceOf(
      RateLimitError,
    );

    // The counter lives in the database, so a second replica sees the same
    // total rather than starting its own.
    const row = await prisma.rateLimitCounter.findUnique({ where: { key } });
    expect(row?.count).toBeGreaterThan(3);
  });
});
