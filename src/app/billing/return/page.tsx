import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getOwnedCheckout } from '@/lib/billing/checkout';
import { getEntitlements } from '@/lib/billing/entitlements';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'تأكيد الدفع' };

/**
 * Return page after provider approval.
 *
 * This page grants nothing. Returning from PayPal proves the customer pressed
 * a button, not that money moved — activation happens only when a verified
 * webhook arrives. So the page reports the *current* state and asks the
 * customer to wait when confirmation has not landed yet.
 */
export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { checkout } = await searchParams;

  const [entitlements, checkoutSession] = await Promise.all([
    getEntitlements(session.userId),
    checkout ? getOwnedCheckout(checkout, session.userId) : Promise.resolve(null),
  ]);

  const active = entitlements.active;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/5 p-8 text-center space-y-4">
        {active ? (
          <>
            <h1 className="text-2xl font-bold text-white">تم تفعيل اشتراكك</h1>
            <p className="text-white/60 text-sm">
              خطة {entitlements.planName}. يمكنك البدء الآن.
            </p>
            <Link
              href="/onboarding"
              className="inline-block rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white"
            >
              متابعة الإعداد
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-white">بانتظار تأكيد الدفع</h1>
            <p className="text-white/60 text-sm leading-relaxed">
              استلمنا طلبك ونحن بانتظار تأكيد مزوّد الدفع. لا يُفعّل الاشتراك
              إلا بعد تأكيده — عادةً خلال ثوانٍ. حدّث الصفحة بعد قليل.
            </p>
            {checkoutSession && (
              <p className="text-xs text-white/30 font-mono">
                مرجع الطلب: {checkoutSession.id}
              </p>
            )}
            <Link href="/billing" className="inline-block text-sm text-violet-300">
              حالة الاشتراك ←
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
