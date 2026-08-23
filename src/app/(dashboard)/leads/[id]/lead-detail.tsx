'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Play, ShieldCheck, Ban } from 'lucide-react';
import { GradeBadge } from '@/components/leads/grade-badge';
import { scoreLead } from '@/lib/lead-scoring';

const STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'WON',
  'LOST',
] as const;

const STATUS_LABEL: Record<string, string> = {
  NEW: 'جديد',
  CONTACTED: 'تم التواصل',
  QUALIFIED: 'مؤهّل',
  PROPOSAL: 'عرض مقدَّم',
  WON: 'مكسوب',
  LOST: 'مفقود',
};

// Kept local rather than imported from AGENT_DEFAULTS: this is a client
// component, and importing the defaults would ship every system prompt to the
// browser. Only the types that act on a single lead belong here.
const AGENTS = ['SALES', 'STRATEGIST', 'MARKETING', 'CONTENT', 'RESEARCH', 'CEO'];

interface LeadView {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  status: string;
  score: number;
  rating: number | null;
  ratingCount: number | null;
  assignedAgent: string | null;
  createdAt: string;
  lastContactedAt: string | null;
}

export function LeadDetail({
  lead,
  activities,
  approvals,
}: {
  lead: LeadView;
  activities: Array<{
    id: string;
    type: string;
    message: string;
    actor: string | null;
    createdAt: string;
  }>;
  approvals: Array<{
    id: string;
    status: string;
    objective: string;
    createdAt: string;
  }>;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(lead.status);
  const [agent, setAgent] = useState(lead.assignedAgent ?? 'SALES');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<
    { kind: 'blocked' | 'approval' | 'autonomous'; text: string } | null
  >(null);

  // Recomputed here rather than stored, so the reasons shown are always the
  // ones that produced the number beside them. `scoreLead` is pure, so this
  // costs nothing and cannot drift from what the server computed.
  const scoring = scoreLead(lead);
  const overridden = scoring.score !== lead.score;

  async function patch(updates: Record<string, unknown>) {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'تعذّر التحديث.');
        return;
      }

      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runAgent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOutcome(null);

    const objective = String(
      new FormData(e.currentTarget).get('objective') ?? '',
    );

    try {
      const res = await fetch(`/api/leads/${lead.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ agentType: agent, objective }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 403) {
        setOutcome({ kind: 'blocked', text: data.reason ?? 'محظور بالسياسة.' });
        router.refresh();
        return;
      }

      if (!res.ok) {
        setError(data.error ?? 'تعذّر تشغيل الوكيل.');
        return;
      }

      setOutcome(
        data.status === 'approval_required'
          ? {
              kind: 'approval',
              text:
                data.approval?.decision?.recommendedAction ??
                'أُنشئ مقترح بانتظار اعتمادك.',
            }
          : {
              kind: 'autonomous',
              text: data.decision?.recommendedAction ?? 'تم التنفيذ.',
            },
      );

      router.refresh();
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/leads" className="text-sm text-white/40 hover:text-white/70">
            ← العملاء المحتملون
          </Link>
          <h1 className="text-3xl font-bold text-white mt-1">
            {lead.companyName}
          </h1>
          <p className="text-white/50 text-sm mt-1">
            {lead.contactName ?? '—'}
            {lead.email ? ` · ${lead.email}` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
            <h2 className="text-lg font-semibold text-white">تشغيل وكيل</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5 block">
                <span className="block text-sm font-medium text-white/80">
                  الوكيل
                </span>
                <select
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none"
                >
                  {AGENTS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5 block">
                <span className="block text-sm font-medium text-white/80">
                  الحالة
                </span>
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    void patch({ status: e.target.value });
                  }}
                  disabled={busy}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <form onSubmit={runAgent} className="space-y-3">
              <Input
                name="objective"
                label="الهدف"
                placeholder="اكتب رسالة تعريفية مناسبة لهذه الشركة"
                required
                minLength={5}
              />
              <Button type="submit" isLoading={busy} disabled={busy}>
                <Play className="h-4 w-4 ml-1" />
                تشغيل
              </Button>
            </form>

            {outcome?.kind === 'blocked' && (
              <p className="flex items-start gap-2 text-sm text-red-200 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <Ban className="h-4 w-4 shrink-0 mt-0.5" />
                {outcome.text}
              </p>
            )}

            {outcome?.kind === 'approval' && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                <p className="flex items-start gap-2 text-sm text-amber-200">
                  <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                  بانتظار اعتمادك
                </p>
                <p className="text-sm text-white/85 whitespace-pre-wrap">
                  {outcome.text}
                </p>
                <Link
                  href="/approvals"
                  className="inline-block text-sm text-violet-300"
                >
                  الذهاب إلى الموافقات ←
                </Link>
              </div>
            )}

            {outcome?.kind === 'autonomous' && (
              <p className="text-sm text-white/85 rounded-xl border border-green-500/30 bg-green-500/10 p-3">
                {outcome.text}
              </p>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-semibold text-white mb-4">السجل</h2>

            {activities.length === 0 ? (
              <p className="text-white/50 text-sm">لا يوجد نشاط بعد.</p>
            ) : (
              <ul className="space-y-3">
                {activities.map((activity) => (
                  <li key={activity.id} className="flex gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-400 mt-2 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-white/85">{activity.message}</p>
                      <p className="text-xs text-white/30 mt-0.5">
                        {new Date(activity.createdAt).toLocaleString('ar')}
                        {activity.actor ? ` · ${activity.actor}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white/70">
                لماذا هذه الدرجة
              </h2>
              <GradeBadge score={lead.score} />
            </div>

            <ul className="space-y-1.5 text-sm text-white/70">
              {scoring.reasons.map((reason) => (
                <li key={reason} className="flex gap-2">
                  <span className="text-white/25">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>

            {overridden && (
              <p className="text-xs text-amber-200/80 border-t border-white/10 pt-2">
                الدرجة المحفوظة {lead.score} عُدِّلت يدويًا؛ الحساب من الإشارات
                أعلاه يعطي {scoring.score}.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white/70">التفاصيل</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-white/40">الفرصة</dt>
                <dd>
                  <GradeBadge score={lead.score} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-white/40">آخر تواصل</dt>
                <dd className="text-white/85">
                  {lead.lastContactedAt
                    ? new Date(lead.lastContactedAt).toLocaleDateString('ar')
                    : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-white/40">أُضيف</dt>
                <dd className="text-white/85">
                  {new Date(lead.createdAt).toLocaleDateString('ar')}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-sm font-semibold text-white/70 mb-3">
              الموافقات المرتبطة
            </h2>

            {approvals.length === 0 ? (
              <p className="text-white/40 text-sm">لا توجد.</p>
            ) : (
              <ul className="space-y-2">
                {approvals.map((approval) => (
                  <li key={approval.id} className="text-sm">
                    <Link
                      href="/approvals"
                      className="text-white/75 hover:text-white truncate block"
                    >
                      {approval.objective}
                    </Link>
                    <span className="text-xs text-white/30">
                      {approval.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
