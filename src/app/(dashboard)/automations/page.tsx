import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { getEntitlements } from '@/lib/billing/entitlements';
import { AGENT_DEFAULTS } from '@/lib/ai/agent-defaults';
import { AutomationsBoard } from './automations-board';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الأتمتة' };

export default async function AutomationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [triggers, entitlements, jobs] = await Promise.all([
    prisma.automationTrigger.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
    }),
    getEntitlements(session.userId),
    // Execution history comes from the existing job queue rather than a
    // parallel table, so what the customer sees is what the worker actually ran.
    prisma.job.findMany({
      where: { userId: session.userId, triggerId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        triggerId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        attempts: true,
        lastError: true,
      },
    }),
  ]);

  const enabledCount = triggers.filter((t) => t.enabled).length;

  return (
    <AutomationsBoard
      initialTriggers={triggers.map((t) => ({
        id: t.id,
        name: t.name,
        enabled: t.enabled,
        kind: t.kind,
        leadStatus: t.leadStatus,
        agentType: t.agentType,
        objectiveTemplate: t.objectiveTemplate,
        cooldownHours: t.cooldownHours,
        lastRunAt: t.lastRunAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }))}
      runs={jobs.map((j) => ({
        id: j.id,
        triggerId: j.triggerId,
        status: j.status,
        createdAt: j.createdAt.toISOString(),
        finishedAt: j.updatedAt.toISOString(),
        attempts: j.attempts,
        lastError: j.lastError,
      }))}
      agents={AGENT_DEFAULTS.map((a) => ({
        type: a.type,
        label: a.arabicName,
      }))}
      enabledCount={enabledCount}
      // The limit is read from the entitlement layer, never hardcoded. The
      // server enforces it too; this only lets the UI explain itself.
      limit={entitlements.limits['automations.max']}
      planName={entitlements.planName}
      active={entitlements.active}
    />
  );
}
