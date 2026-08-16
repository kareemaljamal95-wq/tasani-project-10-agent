'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Check, X, Pencil, Send, AlertTriangle } from 'lucide-react';

export interface ApprovalView {
  id: string;
  agentId: string;
  objective: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EDITED' | 'SENT' | 'FAILED';
  amountUsd: number | null;
  recipient: string | null;
  failureReason: string | null;
  createdAt: string;
  recommendedAction: string;
  rationaleSummary: string;
  riskLevel: string;
  edited: boolean;
}

const STATUS_STYLE: Record<ApprovalView['status'], string> = {
  PENDING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  APPROVED: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  EDITED: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  SENT: 'bg-green-500/15 text-green-300 border-green-500/30',
  REJECTED: 'bg-white/10 text-white/50 border-white/20',
  FAILED: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const STATUS_LABEL: Record<ApprovalView['status'], string> = {
  PENDING: 'بانتظار الاعتماد',
  APPROVED: 'معتمد — جاهز للإرسال',
  EDITED: 'مُعدّل',
  SENT: 'أُرسل',
  REJECTED: 'مرفوض',
  FAILED: 'فشل الإرسال',
};

export function ApprovalQueue({
  initialApprovals,
}: {
  initialApprovals: ApprovalView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  async function act(
    id: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    setBusyId(id);
    setError(null);

    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });

      const payload = await res.json().catch(() => ({}));

      // A failed dispatch returns 502 with the approval already marked FAILED.
      // Surfacing the reason matters more than a generic error here.
      if (!res.ok) setError(payload.error ?? 'تعذّر تنفيذ الإجراء.');

      setEditingId(null);
      startTransition(() => router.refresh());
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    } finally {
      setBusyId(null);
    }
  }

  if (initialApprovals.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
        <p className="text-white/60">لا توجد عناصر بانتظار الاعتماد.</p>
        <p className="text-white/35 text-sm mt-2">
          عندما يقترح وكيل إجراءً خارجيًا، سيظهر هنا لاعتماده قبل الإرسال.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {initialApprovals.map((item) => {
        const busy = busyId === item.id || isPending;
        const canDecide = item.status === 'PENDING' || item.status === 'EDITED';
        const canSend = item.status === 'APPROVED';

        return (
          <article
            key={item.id}
            className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 space-y-4"
          >
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-white/40">
                    {item.agentId}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                  {item.edited && (
                    <span className="text-xs text-violet-300">مُعدّل يدويًا</span>
                  )}
                </div>
                <h2 className="text-white font-medium mt-2 break-words">
                  {item.objective}
                </h2>
              </div>

              <div className="text-left shrink-0">
                {item.amountUsd !== null && (
                  <p className="text-white font-semibold">
                    ${item.amountUsd.toLocaleString()}
                  </p>
                )}
                <p className="text-xs text-white/40">خطورة: {item.riskLevel}</p>
              </div>
            </header>

            {item.recipient && (
              <p className="text-xs text-white/50">
                المستلم: <span className="font-mono">{item.recipient}</span>
              </p>
            )}

            {editingId === item.id ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white outline-none focus:border-violet-500/50"
              />
            ) : (
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-sm text-white/85 whitespace-pre-wrap">
                  {item.recommendedAction}
                </p>
              </div>
            )}

            {item.rationaleSummary && (
              <p className="text-xs text-white/45">{item.rationaleSummary}</p>
            )}

            {item.status === 'FAILED' && item.failureReason && (
              <p className="flex items-start gap-2 text-xs text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
                {item.failureReason}
              </p>
            )}

            <footer className="flex flex-wrap gap-2 pt-1">
              {editingId === item.id ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy || draft.trim().length === 0}
                    onClick={() =>
                      act(item.id, { action: 'edit', editedAction: draft })
                    }
                  >
                    حفظ التعديل
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    إلغاء
                  </Button>
                </>
              ) : (
                <>
                  {canDecide && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => act(item.id, { action: 'approve' })}
                    >
                      <Check className="h-4 w-4 ml-1" />
                      اعتماد
                    </Button>
                  )}

                  {item.status === 'PENDING' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(item.id);
                        setDraft(item.recommendedAction);
                      }}
                    >
                      <Pencil className="h-4 w-4 ml-1" />
                      تعديل
                    </Button>
                  )}

                  {canDecide && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => act(item.id, { action: 'reject' })}
                    >
                      <X className="h-4 w-4 ml-1" />
                      رفض
                    </Button>
                  )}

                  {/* Sending is a separate deliberate action, never a side
                      effect of approving. */}
                  {canSend && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => act(item.id, { action: 'dispatch' })}
                    >
                      <Send className="h-4 w-4 ml-1" />
                      إرسال الآن
                    </Button>
                  )}
                </>
              )}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
