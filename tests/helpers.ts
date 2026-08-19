import { prisma } from '@/lib/prisma';
import { AGENT_DEFAULTS } from '@/lib/ai/agent-defaults';
import { syncCatalog } from '@/lib/billing';

/**
 * Shared fixtures.
 *
 * Every test starts from an empty database so ordering cannot make one test
 * depend on another's leftovers. TRUNCATE ... CASCADE is used rather than
 * per-model deletes because the graph has enough foreign keys that delete
 * ordering would be its own maintenance burden.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "BillingEvent", "CheckoutSession", "OfferRedemption", "Offer",
      "UsageCounter", "Subscription", "Price", "Plan",
      "Job", "AutomationTrigger", "Activity", "Approval", "AgentRun",
      "AuditLog", "Lead", "Message", "Conversation", "AgentConfig",
      "Memory", "Task", "Goal", "Habit", "CalendarEvent",
      "PasswordResetToken", "RateLimitCounter", "SystemSetting", "User"
    RESTART IDENTITY CASCADE
  `);
}

export interface TestUser {
  id: string;
  email: string;
}

let counter = 0;

export async function createTestUser(
  options: { onboarded?: boolean } = {},
): Promise<TestUser> {
  counter += 1;

  const user = await prisma.user.create({
    data: {
      email: `user${counter}-${Date.now()}@example.test`,
      name: `Test User ${counter}`,
      password: '$2a$12$notarealhashnotarealhashnotarealhashnotarealhash',
      onboardingCompletedAt: options.onboarded === false ? null : new Date(),
    },
  });

  return { id: user.id, email: user.email };
}

/** Gives a user the standard workforce, as onboarding and the agents page do. */
export async function provisionAgents(userId: string): Promise<void> {
  await prisma.agentConfig.createMany({
    data: AGENT_DEFAULTS.map((agent) => ({
      userId,
      type: agent.type,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      temperature: agent.temperature,
      isEnabled: true,
    })),
    skipDuplicates: true,
  });
}

let subscriptionCounter = 0;

/**
 * Gives an account an active paid subscription.
 *
 * Agent execution meters usage against entitlements, so any test that runs an
 * agent needs a plan — an unpaid account is correctly refused before the model
 * is called. Defaults to `scale` so plan limits never incidentally fail a test
 * that is about something else.
 */
export async function giveTestSubscription(
  userId: string,
  planCode = 'scale',
): Promise<void> {
  await syncCatalog();

  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
  const price = await prisma.price.findFirstOrThrow({
    where: { planId: plan.id, interval: 'MONTH' },
  });

  subscriptionCounter += 1;

  await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      priceId: price.id,
      provider: 'test',
      providerSubscriptionId: `TEST-SUB-${subscriptionCounter}-${Date.now()}`,
      status: 'ACTIVE',
      currency: price.currency,
      amount: price.amount,
      interval: 'MONTH',
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 25 * 86_400_000),
    },
  });
}

/** Clears provider keys so `hasAnyAIProvider()` reports none configured. */
export function clearProviderKeys(): void {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
}

export function setProviderKey(): void {
  process.env.OPENAI_API_KEY = 'sk-test-key-not-used-for-real-calls';
}
