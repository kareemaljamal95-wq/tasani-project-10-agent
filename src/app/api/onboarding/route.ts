import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { provisionDefaultAgents } from '@/lib/ai/provisioning';
import { configuredProviders } from '@/lib/ai/models';
import { recordActivity } from '@/lib/activity';
import { track } from '@/lib/analytics';
import {
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

/**
 * First-run onboarding.
 *
 * Resumable and run-once: `onboardingStep` records progress so a half-finished
 * flow resumes where it stopped, and `onboardingCompletedAt` is a timestamp
 * rather than a flag, so completion is idempotent and never repeats.
 *
 * The flow is intentionally short — profile, agents, approvals — because its
 * job is to get an account to a first useful action, not to sell.
 */
export const ONBOARDING_STEPS = ['profile', 'agents', 'approvals'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const progressSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save_step'),
    step: z.enum(ONBOARDING_STEPS),
    name: z.string().min(1).max(120).optional(),
    timezone: z.string().min(1).max(64).optional(),
    language: z.enum(['EN', 'AR']).optional(),
  }),
  z.object({ action: z.literal('provision_agents') }),
  z.object({ action: z.literal('complete') }),
]);

export async function GET() {
  try {
    const session = await requireUser();
    rateLimit(`onboarding:${session.userId}`);

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

    if (!user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }

    const agentCount = await prisma.agentConfig.count({
      where: { userId: session.userId },
    });

    return NextResponse.json({
      completed: user.onboardingCompletedAt !== null,
      step: user.onboardingStep ?? ONBOARDING_STEPS[0],
      profile: {
        name: user.name,
        timezone: user.timezone,
        language: user.language,
      },
      agentsProvisioned: agentCount,
      providers: configuredProviders(),
    });
  } catch (error) {
    return handleRouteError(error, 'GET /api/onboarding');
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`onboarding-write:${session.userId}`, 30);

    const body = await parseBody(req, progressSchema);

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { onboardingCompletedAt: true },
    });

    // Completion is terminal. A replayed request is answered from the stored
    // state instead of re-running the flow.
    if (user?.onboardingCompletedAt) {
      return NextResponse.json({ completed: true, step: null });
    }

    if (body.action === 'save_step') {
      const currentIndex = ONBOARDING_STEPS.indexOf(body.step);
      const next = ONBOARDING_STEPS[currentIndex + 1] ?? body.step;

      await prisma.user.update({
        where: { id: session.userId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.timezone ? { timezone: body.timezone } : {}),
          ...(body.language ? { language: body.language } : {}),
          onboardingStep: next,
        },
      });

      if (body.step === ONBOARDING_STEPS[0]) {
        track('onboarding_started', { userId: session.userId });
      }

      return NextResponse.json({ completed: false, step: next });
    }

    if (body.action === 'provision_agents') {
      // Idempotent, and enables only as many agents as the plan allows.
      const provisioned = await provisionDefaultAgents(session.userId);

      return NextResponse.json({
        completed: false,
        agentsProvisioned: provisioned.total,
        agentsEnabled: provisioned.enabled,
      });
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { onboardingCompletedAt: new Date(), onboardingStep: null },
    });

    await recordActivity({
      userId: session.userId,
      type: 'note',
      message: 'اكتمل الإعداد الأولي للحساب.',
      actor: session.email,
    });

    track('onboarding_completed', { userId: session.userId });

    return NextResponse.json({ completed: true, step: null });
  } catch (error) {
    return handleRouteError(error, 'POST /api/onboarding');
  }
}
