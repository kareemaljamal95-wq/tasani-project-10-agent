'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function BillingControls({
  cancelAtPeriodEnd,
}: {
  cancelAtPeriodEnd: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'cancel' | 'resume') {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/billing/subscription', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? 'تعذّر تنفيذ الطلب.');
      else router.refresh();
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3">
      <h2 className="text-lg font-semibold text-white">إدارة الاشتراك</h2>

      {/* Cancellation is at period end: the customer paid for this period and
          keeps it. */}
      {cancelAtPeriodEnd ? (
        <>
          <p className="text-white/60 text-sm">
            التجديد متوقف. يمكنك استئنافه قبل نهاية الفترة.
          </p>
          <Button onClick={() => act('resume')} isLoading={busy} disabled={busy}>
            استئناف التجديد
          </Button>
        </>
      ) : (
        <>
          <p className="text-white/60 text-sm">
            الإلغاء يوقف التجديد فقط — يبقى وصولك حتى نهاية الفترة المدفوعة.
          </p>
          <Button
            variant="ghost"
            onClick={() => act('cancel')}
            isLoading={busy}
            disabled={busy}
          >
            إيقاف التجديد
          </Button>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
