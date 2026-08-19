import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/session';
import { AGENT_DEFAULTS } from '@/lib/ai/agent-defaults';
import { provisionDefaultAgents } from '@/lib/ai/provisioning';
import { AgentWorkspace } from './agent-workspace';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الوكلاء' };

/**
 * Agent workforce.
 *
 * The page previously rendered a static AGENT_DISPLAY_INFO constant, so it
 * showed the same eight cards to everyone regardless of what was actually
 * provisioned, enabled, or configured for the account. It now reads the
 * account's own AgentConfig rows, provisioning the defaults on first visit.
 *
 * systemPrompt is intentionally not selected — it is server-side
 * configuration, and shipping it to the browser hands an attacker the exact
 * text to craft an override against.
 */
export default async function AgentsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const userId = session.userId;

  await provisionDefaultAgents(userId);

  const agents = await prisma.agentConfig.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      name: true,
      description: true,
      model: true,
      isEnabled: true,
    },
  });

  const arabicNames = new Map(
    AGENT_DEFAULTS.map((agent) => [agent.type, agent.arabicName]),
  );

  return (
    <AgentWorkspace
      agents={agents.map((agent) => ({
        ...agent,
        arabicName: arabicNames.get(agent.type) ?? agent.name,
      }))}
    />
  );
}
