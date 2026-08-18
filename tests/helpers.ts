import { prisma } from '@/lib/prisma';
import { AGENT_DEFAULTS } from '@/lib/ai/agent-defaults';

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

/** Clears provider keys so `hasAnyAIProvider()` reports none configured. */
export function clearProviderKeys(): void {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
}

export function setProviderKey(): void {
  process.env.OPENAI_API_KEY = 'sk-test-key-not-used-for-real-calls';
}
