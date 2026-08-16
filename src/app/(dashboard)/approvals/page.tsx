import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { listApprovals } from '@/lib/approvals';
import { isOutreachConfigured } from '@/lib/outreach';
import { ApprovalQueue } from './approval-queue';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الموافقات' };

/**
 * The human-sovereignty queue.
 *
 * Data is read server-side for the owner's tenant only; the client component
 * handles the transitions.
 */
export default async function ApprovalsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const approvals = await listApprovals(session.userId, { limit: 100 });

  return (
    <div className="space-y-6 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">الموافقات</h1>
        <p className="text-white/60 mt-1">
          لا تُرسل أي رسالة خارجية قبل اعتمادك لها.
        </p>
      </div>

      {!isOutreachConfigured() && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"
        >
          الإرسال الخارجي غير مُفعّل. يمكنك الاعتماد والتعديل والرفض الآن، لكن
          الإرسال سيفشل حتى تُضبط <code className="font-mono">OUTREACH_TRANSPORT</code>{' '}
          و<code className="font-mono">SMTP_URL</code>.
        </div>
      )}

      <ApprovalQueue
        initialApprovals={approvals.map((a) => ({
          id: a.id,
          agentId: a.agentId,
          objective: a.objective,
          status: a.status,
          amountUsd: a.amountUsd ? Number(a.amountUsd) : null,
          recipient: a.recipient,
          failureReason: a.failureReason,
          createdAt: a.createdAt.toISOString(),
          recommendedAction:
            a.editedAction ??
            (a.decision as { recommendedAction?: string })?.recommendedAction ??
            '',
          rationaleSummary:
            (a.decision as { rationaleSummary?: string })?.rationaleSummary ?? '',
          riskLevel: (a.decision as { riskLevel?: string })?.riskLevel ?? 'medium',
          edited: a.editedAction !== null,
        }))}
      />
    </div>
  );
}
