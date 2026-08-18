import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { availableModels, configuredProviders, validateModelSelection } from '@/lib/ai/models';
import { getManualOverride, setManualOverride } from '@/lib/ai/policies';
import { isOutreachConfigured } from '@/lib/outreach';
import {
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

/**
 * Account settings.
 *
 * Reuses the configuration that already exists rather than introducing a
 * second system: profile and preferences live on User, per-agent model and
 * temperature on AgentConfig, and the sovereignty switch in SystemSetting via
 * the policy module.
 *
 * Provider credentials are deliberately not part of this surface. They are
 * process-level environment variables; the API reports only whether each
 * provider is *configured*, never any key material, and there is no write path
 * that could put a secret in the database or the browser.
 */

const updateSchema = z.object({
  name: z.string().min(1).max(120).nullable().optional(),
  language: z.enum(['EN', 'AR']).optional(),
  theme: z.enum(['DARK', 'LIGHT', 'SYSTEM']).optional(),
  timezone: z.string().min(1).max(64).optional(),
  manualOverride: z.boolean().optional(),
  agents: z
    .array(
      z.object({
        id: z.string().min(1),
        model: z.string().min(1).max(100).optional(),
        temperature: z.number().min(0).max(2).optional(),
        isEnabled: z.boolean().optional(),
      }),
    )
    .max(50)
    .optional(),
});

export async function GET() {
  try {
    const session = await requireUser();
    rateLimit(`settings:${session.userId}`);

    const [user, agents, manualOverride] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          id: true,
          email: true,
          name: true,
          language: true,
          theme: true,
          timezone: true,
          onboardingCompletedAt: true,
        },
      }),
      prisma.agentConfig.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: 'asc' },
        // systemPrompt withheld: server-side configuration, and exposing it
        // hands an attacker the text to craft an override against.
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

    if (!user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }

    return NextResponse.json({
      user,
      agents,
      manualOverride,
      // Booleans only — never the key values themselves.
      providers: configuredProviders(),
      models: availableModels(),
      outreachConfigured: isOutreachConfigured(),
    });
  } catch (error) {
    return handleRouteError(error, 'GET /api/settings');
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`settings-write:${session.userId}`, 30);

    const body = await parseBody(req, updateSchema);

    // Models are validated on write, not on every render: verifying a model id
    // costs a provider round trip, and doing it per page load would add
    // latency and burn quota for nothing.
    for (const agent of body.agents ?? []) {
      if (!agent.model) continue;

      const validation = validateModelSelection(agent.model);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.reason }, { status: 400 });
      }
    }

    const profileFields = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.language ? { language: body.language } : {}),
      ...(body.theme ? { theme: body.theme } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
    };

    if (Object.keys(profileFields).length > 0) {
      await prisma.user.update({
        where: { id: session.userId },
        data: profileFields,
      });
    }

    if (body.manualOverride !== undefined) {
      await setManualOverride(
        session.userId,
        body.manualOverride,
        session.email,
      );
    }

    for (const agent of body.agents ?? []) {
      const { id, ...updates } = agent;
      if (Object.keys(updates).length === 0) continue;

      // updateMany scoped by userId: an agent id from another account matches
      // nothing rather than being reconfigured.
      await prisma.agentConfig.updateMany({
        where: { id, userId: session.userId },
        data: updates,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/settings');
  }
}
