import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ApprovalNotFoundError,
  ApprovalStateError,
  approveApproval,
  dispatchApproval,
  editApproval,
  getApproval,
  rejectApproval,
} from '@/lib/approvals';
import { handleRouteError, parseBody, rateLimit, requireUser } from '@/lib/api/guard';
import { track } from '@/lib/analytics';

/**
 * Human transitions on a single approval.
 *
 * `dispatch` is a separate, explicit action rather than a side effect of
 * `approve`: approving records the human decision, sending is the act that
 * leaves the building, and keeping them apart means a mis-click cannot send.
 */
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().max(2000).optional() }),
  z.object({ action: z.literal('edit'), editedAction: z.string().min(1).max(20_000) }),
  z.object({ action: z.literal('dispatch') }),
]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    const { id } = await params;

    const approval = await getApproval(id, session.userId);
    return NextResponse.json({ approval });
  } catch (error) {
    if (error instanceof ApprovalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleRouteError(error, 'GET /api/approvals/[id]');
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    rateLimit(`approval-action:${session.userId}`, 30);

    const { id } = await params;
    const body = await parseBody(req, actionSchema);
    const actor = session.email;

    switch (body.action) {
      case 'approve': {
        const approval = await approveApproval(id, session.userId, actor);
        track('approval_granted', { userId: session.userId, approvalId: id });
        return NextResponse.json({ approval });
      }

      case 'reject': {
        const approval = await rejectApproval(id, session.userId, actor, body.reason);
        track('approval_rejected', { userId: session.userId, approvalId: id });
        return NextResponse.json({ approval });
      }

      case 'edit': {
        const approval = await editApproval(
          id,
          session.userId,
          body.editedAction,
          actor,
        );
        return NextResponse.json({ approval });
      }

      case 'dispatch': {
        const approval = await dispatchApproval(id, session.userId, actor);

        // A dispatch that failed is reported as such: the row is FAILED and
        // the caller gets 502, not a success response for a message that
        // never left.
        if (approval.status === 'FAILED') {
          return NextResponse.json(
            { approval, error: approval.failureReason },
            { status: 502 },
          );
        }

        track('outreach_sent', { userId: session.userId, approvalId: id });

        return NextResponse.json({ approval });
      }
    }
  } catch (error) {
    if (error instanceof ApprovalNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof ApprovalStateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return handleRouteError(error, 'POST /api/approvals/[id]');
  }
}
