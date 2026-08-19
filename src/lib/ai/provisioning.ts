import { prisma } from '@/lib/prisma';
import { AGENT_DEFAULTS } from './agent-defaults';
import { getEntitlements } from '@/lib/billing/entitlements';

/**
 * Provisions an account's agent workforce.
 *
 * Previously duplicated across onboarding, the agents page and the agents API,
 * each enabling all eight agents — which silently exceeded every plan limit
 * the moment billing arrived.
 *
 * All agents are created so the customer can see the full workforce and choose
 * between them, but only as many as the plan allows are enabled. A Starter
 * account gets its one agent switched on; the rest sit visible and off, which
 * is also the upgrade prompt.
 */
export async function provisionDefaultAgents(userId: string): Promise<{
  total: number;
  enabled: number;
}> {
  // skipDuplicates plus @@unique([userId, type]) makes this safe to call on
  // every visit and safe under concurrency.
  await prisma.agentConfig.createMany({
    data: AGENT_DEFAULTS.map((agent) => ({
      userId,
      type: agent.type,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      temperature: agent.temperature,
      isEnabled: false,
    })),
    skipDuplicates: true,
  });

  const entitlements = await getEntitlements(userId);
  const max = entitlements.limits['agents.max'];

  const alreadyEnabled = await prisma.agentConfig.count({
    where: { userId, isEnabled: true },
  });

  if (alreadyEnabled < max) {
    // Enable in catalog order, so the CEO agent — the coordinator — is the one
    // a single-agent plan gets.
    const candidates = await prisma.agentConfig.findMany({
      where: { userId, isEnabled: false },
      orderBy: { createdAt: 'asc' },
      take: max - alreadyEnabled,
      select: { id: true },
    });

    if (candidates.length > 0) {
      await prisma.agentConfig.updateMany({
        where: { id: { in: candidates.map((c) => c.id) }, userId },
        data: { isEnabled: true },
      });
    }
  }

  const [total, enabled] = await Promise.all([
    prisma.agentConfig.count({ where: { userId } }),
    prisma.agentConfig.count({ where: { userId, isEnabled: true } }),
  ]);

  return { total, enabled };
}
