import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getEntitlements, getActiveSubscription } from '@/lib/billing/entitlements';
import { getUsage } from '@/lib/billing/usage';
import { formatAmount } from '@/lib/billing/catalog';
import { BillingControls } from './billing-controls';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الاشتراك' };

/**
 * Customer billing self-service.
 *
 * Reads local state only. No provider API call happens on this render — the
 * dashboard must not depend on PayPal's availability.
 */
export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [entitlements, subscription, usage] = await Promise.all([
    getEntitlements(session.userId),
    getActiveSubscription(session.userId),
    getUsage(session.userId),
  ]);

  return (
    <div className="space-y-6 animate-in max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-white">الاشتراك</h1>
        <p className="text-white/60 mt-1">خطتك واستهلاكك الحالي</p>
      </div>

      {!entitlements.active && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-3">
          <p className="text-amber-200 text-sm">
            {entitlements.reason ?? 'لا يوجد اشتراك نشط.'}
          </p>
          <Link
            href="/pricing"
            className="inline-block rounded-xl bg-violet-600 px-4 py-2 text-sm text-white"
          >
            اختر خطة
          </Link>
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3">
        <h2 className="text-lg font-semibold text-white">الخطة</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-white/40">الخطة</dt>
            <dd className="text-white/85">{entitlements.planName ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-white/40">الحالة</dt>
            <dd className="text-white/85">{entitlements.status ?? '—'}</dd>
          </div>
          {subscription && (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-white/40">الدورة</dt>
                <dd className="text-white/85">
                  {subscription.interval === 'YEAR' ? 'سنوي' : 'شهري'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/40">المبلغ</dt>
                <dd className="text-white/85">
                  {formatAmount(subscription.amount, subscription.currency)}
                </dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-white/40">التجديد</dt>
            <dd className="text-white/85">
              {entitlements.currentPeriodEnd
                ? new Date(entitlements.currentPeriodEnd).toLocaleDateString('ar')
                : '—'}
            </dd>
          </div>
        </dl>

        {entitlements.cancelAtPeriodEnd && (
          <p className="text-xs text-amber-300">
            سيتوقف التجديد في نهاية الفترة الحالية، ويبقى وصولك حتى ذلك التاريخ.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3">
        <h2 className="text-lg font-semibold text-white">الاستهلاك</h2>
        <div className="flex justify-between text-sm">
          <span className="text-white/60">إجراءات الذكاء الاصطناعي</span>
          <span className="text-white/85">
            {usage.used} / {usage.limit}
          </span>
        </div>
        <div
          className="h-2 rounded-full bg-white/10 overflow-hidden"
          role="progressbar"
          aria-valuenow={usage.percentUsed}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full ${
              usage.percentUsed >= 100
                ? 'bg-red-400'
                : usage.percentUsed >= 80
                  ? 'bg-amber-400'
                  : 'bg-green-400'
            }`}
            style={{ width: `${Math.min(usage.percentUsed, 100)}%` }}
          />
        </div>

        {usage.threshold && (
          <p
            className={`text-xs ${
              usage.threshold === 100 ? 'text-red-300' : 'text-amber-300'
            }`}
          >
            {usage.threshold === 100
              ? 'استهلكت حصتك لهذه الفترة. الترقية تعيد التشغيل فورًا.'
              : `اقتربت من الحد (${usage.percentUsed}%).`}{' '}
            <Link href="/pricing" className="underline">
              ترقية
            </Link>
          </p>
        )}
      </section>

      {subscription && (
        <BillingControls cancelAtPeriodEnd={entitlements.cancelAtPeriodEnd} />
      )}
    </div>
  );
}
