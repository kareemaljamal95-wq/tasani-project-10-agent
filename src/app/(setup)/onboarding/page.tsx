import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/session';
import { configuredProviders } from '@/lib/ai/models';
import { OnboardingFlow } from './onboarding-flow';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الإعداد الأولي' };

/**
 * First-run setup.
 *
 * Redirects straight to the dashboard once complete, so the flow cannot be
 * re-entered by navigating back to the URL — the run-once guarantee lives on
 * the server, not in client state.
 */
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      name: true,
      timezone: true,
      language: true,
      onboardingStep: true,
      onboardingCompletedAt: true,
    },
  });

  if (!user) redirect('/login');
  if (user.onboardingCompletedAt) redirect('/dashboard');

  const agentsProvisioned = await prisma.agentConfig.count({
    where: { userId: session.userId },
  });

  return (
    <OnboardingFlow
      initialStep={(user.onboardingStep as 'profile' | 'agents' | 'approvals') ?? 'profile'}
      profile={{
        name: user.name,
        timezone: user.timezone,
        language: user.language,
      }}
      agentsProvisioned={agentsProvisioned}
      providers={configuredProviders()}
    />
  );
}
