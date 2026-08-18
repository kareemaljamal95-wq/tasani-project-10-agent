import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/session';
import { getManualOverride } from '@/lib/ai/policies';
import { availableModels, configuredProviders } from '@/lib/ai/models';
import { isOutreachConfigured } from '@/lib/outreach';
import { SettingsForm } from './settings-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الإعدادات' };

/**
 * Settings.
 *
 * Replaces a page whose six tabs rendered inputs bound to nothing and saved
 * nowhere. Data is loaded server-side for the signed-in account only.
 *
 * Provider credentials never cross this boundary: only booleans describing
 * whether each provider is configured, and agent systemPrompt is not selected
 * at all.
 */
export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [user, agents, manualOverride] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        email: true,
        name: true,
        language: true,
        theme: true,
        timezone: true,
      },
    }),
    prisma.agentConfig.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        name: true,
        model: true,
        temperature: true,
        isEnabled: true,
      },
    }),
    getManualOverride(session.userId),
  ]);

  if (!user) redirect('/login');

  return (
    <SettingsForm
      initial={{
        email: user.email,
        name: user.name,
        language: user.language,
        theme: user.theme,
        timezone: user.timezone,
        manualOverride,
      }}
      agents={agents}
      providers={configuredProviders()}
      models={availableModels()}
      outreachConfigured={isOutreachConfigured()}
    />
  );
}
