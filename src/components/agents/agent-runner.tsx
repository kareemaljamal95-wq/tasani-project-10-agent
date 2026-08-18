'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Play, ShieldCheck, Ban } from 'lucide-react';

/**
 * Runs an agent and shows what came back.
 *
 * This is what connects the product's two halves. /api/agents/run — policy
 * check, model decision, approval creation — was fully implemented and
 * reachable by nothing in the interface, so the approval queue could never
 * receive an item through normal use.
 */

type RunOutcome =
  | { kind: 'approval'; action: string; rationale: string; reason: string }
  | { kind: 'autonomous'; action: string; rationale: string }
  | { kind: 'blocked'; reason: string };

export function AgentRunner({ agentType }: { agentType: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);

  async function run(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOutcome(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);
    const amountRaw = String(form.get('amountUsd') ?? '').trim();
    const recipient = String(form.get('recipient') ?? '').trim();

    try {
      const res = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          agentId: agentType,
          objective: String(form.get('objective') ?? ''),
          ...(amountRaw ? { amountUsd: Number(amountRaw) } : {}),
          ...(recipient ? { recipient, channel: 'email' } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      // A policy block is a legitimate outcome, not an error: it is the
      // sovereignty rules working, so it gets its own presentation.
      if (res.status === 403) {
        setOutcome({ kind: 'blocked', reason: data.reason ?? 'محظور بموجب السياسة.' });
        return;
      }

      if (!res.ok) {
        setError(data.error ?? 'تعذّر تشغيل الوكيل.');
        return;
      }

      if (data.status === 'approval_required') {
        setOutcome({
          kind: 'approval',
          action: data.approval?.decision?.recommendedAction ?? '',
          rationale: data.approval?.decision?.rationaleSummary ?? '',
          reason: data.policy?.reason ?? '',
        });
        // Refreshes the pending count shown elsewhere in the shell.
        router.refresh();
        return;
      }

      setOutcome({
        kind: 'autonomous',
        action: data.decision?.recommendedAction ?? '',
        rationale: data.decision?.rationaleSummary ?? '',
      });
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">تشغيل مهمة</h2>
        <p className="text-white/50 text-sm mt-1">
          صف ما تريده. الوكيل يقترح فقط — لا يُرسل شيء قبل اعتمادك.
        </p>
      </div>

      <form onSubmit={run} className="space-y-4">
        <Input
          name="objective"
          label="الهدف"
          placeholder="مثال: اكتب رسالة تعريفية لعميل محتمل في قطاع التجزئة"
          required
          minLength={5}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            name="amountUsd"
            type="number"
            min={0}
            step="0.01"
            label="المبلغ بالدولار (اختياري)"
            placeholder="0"
          />
          <Input
            name="recipient"
            type="email"
            label="المستلم (اختياري)"
            placeholder="lead@example.com"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <Button type="submit" isLoading={busy} disabled={busy}>
          <Play className="h-4 w-4 ml-1" />
          تشغيل الوكيل
        </Button>
      </form>

      {outcome?.kind === 'blocked' && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="flex items-center gap-2 text-sm text-red-200">
            <Ban className="h-4 w-4 shrink-0" />
            {outcome.reason}
          </p>
        </div>
      )}

      {outcome?.kind === 'approval' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
          <p className="flex items-center gap-2 text-sm text-amber-200">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            يتطلب اعتمادك — {outcome.reason}
          </p>
          <p className="text-sm text-white/85 whitespace-pre-wrap">{outcome.action}</p>
          {outcome.rationale && (
            <p className="text-xs text-white/45">{outcome.rationale}</p>
          )}
          <Link
            href="/approvals"
            className="inline-block text-sm text-violet-300 hover:text-violet-200"
          >
            الذهاب إلى الموافقات ←
          </Link>
        </div>
      )}

      {outcome?.kind === 'autonomous' && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 space-y-1">
          <p className="text-sm text-white/85 whitespace-pre-wrap">{outcome.action}</p>
          {outcome.rationale && (
            <p className="text-xs text-white/45">{outcome.rationale}</p>
          )}
        </div>
      )}
    </div>
  );
}
