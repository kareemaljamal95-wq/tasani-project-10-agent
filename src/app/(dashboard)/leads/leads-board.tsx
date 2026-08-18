'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';

export interface LeadRow {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  status: string;
  score: number;
  assignedAgent: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  NEW: 'جديد',
  CONTACTED: 'تم التواصل',
  QUALIFIED: 'مؤهّل',
  PROPOSAL: 'عرض مقدَّم',
  WON: 'مكسوب',
  LOST: 'مفقود',
};

const STATUS_STYLE: Record<string, string> = {
  NEW: 'bg-white/10 text-white/60 border-white/20',
  CONTACTED: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  QUALIFIED: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  PROPOSAL: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  WON: 'bg-green-500/15 text-green-300 border-green-500/30',
  LOST: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export function LeadsBoard({
  initialLeads,
  counts,
}: {
  initialLeads: LeadRow[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          companyName: String(form.get('companyName') ?? ''),
          contactName: String(form.get('contactName') ?? '') || undefined,
          ...(email ? { email } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 409 is the duplicate-email guard, worth naming precisely.
        setError(data.error ?? 'تعذّرت الإضافة.');
        return;
      }

      setLeads((prev) => [
        {
          id: data.lead.id,
          companyName: data.lead.companyName,
          contactName: data.lead.contactName,
          email: data.lead.email,
          status: data.lead.status,
          score: data.lead.score,
          assignedAgent: data.lead.assignedAgent,
          createdAt: data.lead.createdAt,
        },
        ...prev,
      ]);

      setAdding(false);
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
          <h1 className="text-3xl font-bold text-white">العملاء المحتملون</h1>
          <p className="text-white/60 mt-1">
            من فرصة إلى مشروع — كل إجراء خارجي يمر باعتمادك
          </p>
        </div>

        <Button onClick={() => setAdding((v) => !v)}>
          <Plus className="h-4 w-4 ml-1" />
          إضافة
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.keys(STATUS_LABEL).map((status) => (
          <span
            key={status}
            className={`rounded-full border px-3 py-1 text-xs ${STATUS_STYLE[status]}`}
          >
            {STATUS_LABEL[status]} · {counts[status] ?? 0}
          </span>
        ))}
      </div>

      {adding && (
        <form
          onSubmit={create}
          className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input name="companyName" label="اسم الشركة" required />
            <Input name="contactName" label="جهة الاتصال" />
            <Input name="email" type="email" label="البريد الإلكتروني" />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <Button type="submit" isLoading={busy} disabled={busy}>
            حفظ
          </Button>
        </form>
      )}

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
          <p className="text-white/60">لا يوجد عملاء محتملون بعد.</p>
          <p className="text-white/35 text-sm mt-2">
            أضف أول عميل، ثم شغّل عليه وكيل المبيعات — سيصلك المقترح للاعتماد.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/leads/${lead.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all"
              >
                <div className="min-w-0">
                  <p className="text-white font-medium truncate">
                    {lead.companyName}
                  </p>
                  <p className="text-xs text-white/40 truncate">
                    {lead.contactName ?? '—'}
                    {lead.email ? ` · ${lead.email}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-white/40">
                    {lead.assignedAgent ?? '—'}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${STATUS_STYLE[lead.status]}`}
                  >
                    {STATUS_LABEL[lead.status] ?? lead.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
