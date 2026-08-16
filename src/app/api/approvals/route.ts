import { NextResponse } from 'next/server';
import { ApprovalStatus } from '@prisma/client';
import { z } from 'zod';
import { listApprovals } from '@/lib/approvals';
import { isOutreachConfigured } from '@/lib/outreach';
import {
  clientIp,
  handleRouteError,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';

const statusSchema = z.nativeEnum(ApprovalStatus).optional();

export async function GET(req: Request) {
  try {
    const session = await requireUser();
    rateLimit(`approvals:${session.userId}:${clientIp(req)}`);

    const statusParam = new URL(req.url).searchParams.get('status');
    const parsed = statusSchema.safeParse(statusParam ?? undefined);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: `status must be one of: ${Object.values(ApprovalStatus).join(', ')}`,
        },
        { status: 400 },
      );
    }

    const approvals = await listApprovals(session.userId, { status: parsed.data });

    return NextResponse.json({
      approvals,
      // The UI needs to know whether an approved item can actually be sent,
      // so it can say "sending is not configured" instead of offering a
      // button that will always fail.
      outreachConfigured: isOutreachConfigured(),
    });
  } catch (error) {
    return handleRouteError(error, 'GET /api/approvals');
  }
}
