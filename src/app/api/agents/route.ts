import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { provisionDefaultAgents } from '@/lib/ai/provisioning';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';
import { requireWithinLimit } from '@/lib/billing/entitlements';

/**
 * Agent configuration.
 *
 * The previous version read a hardcoded `demo-user`, so every account shared
 * one workforce, and its PATCH accepted an arbitrary body keyed only by `id` —
 * which allowed rewriting any other tenant's `systemPrompt`, the most direct
 * prompt-injection path in the product.
 */

const updateAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  model: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  isEnabled: z.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`agents:${session.userId}:${clientIp(req)}`);

    await provisionDefaultAgents(session.userId);

    const agents = await prisma.agentConfig.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'asc' },
      // systemPrompt is deliberately not returned: it is server-side
      // configuration, and exposing it hands an attacker the exact text to
      // craft an override against.
      select: {
        id: true,
        type: true,
        name: true,
        description: true,
        model: true,
        temperature: true,
        isEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ agents });
  } catch (error) {
    return handleRouteError(error, 'GET /api/agents');
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`agents:${session.userId}:${clientIp(req)}`);

    const { id, ...updates } = await parseBody(req, updateAgentSchema);

    // Enabling an agent consumes a paid slot, so it is checked against the
    // plan. Counting only *other* enabled agents means re-saving an already
    // enabled one is never blocked by itself.
    if (updates.isEnabled === true) {
      const enabled = await prisma.agentConfig.count({
        where: { userId: session.userId, isEnabled: true, NOT: { id } },
      });

      await requireWithinLimit(session.userId, 'agents.max', enabled);
    }

    // systemPrompt is not in the accepted field set, so it cannot be changed
    // through this route at all.
    const result = await prisma.agentConfig.updateMany({
      where: { id, userId: session.userId },
      data: updates,
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    }

    const agent = await prisma.agentConfig.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        name: true,
        description: true,
        model: true,
        temperature: true,
        isEnabled: true,
      },
    });

    return NextResponse.json({ agent });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/agents');
  }
}
