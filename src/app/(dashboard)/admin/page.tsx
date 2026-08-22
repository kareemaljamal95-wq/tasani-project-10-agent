import { redirect, notFound } from 'next/navigation';
import { SubscriptionStatus, CheckoutStatus } from '@prisma/client';
import { getSession } from '@/lib/auth/session';
import { isAdminEmail } from '@/lib/auth/admin';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الإدارة' };

/** Statuses that mean the customer currently has paid access. */
const ACTIVE = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
];

function money(minorUnits: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(minorUnits / 100);
}

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  // notFound rather than a 403 page: a non-owner should not learn that an
  // admin area exists at this path.
  if (!isAdminEmail(session.email)) notFound();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [users, newUsers, activeSubs, runs, blockedRuns, pending, revenue] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.subscription.count({ where: { status: { in: ACTIVE } } }),
      prisma.agentRun.count(),
      prisma.agentRun.count({ where: { blocked: true } }),
      prisma.approval.count({ where: { status: 'PENDING' } }),
      // Real money only: a CheckoutSession reaches COMPLETED solely through a
      // signature-verified webhook, so this cannot count an abandoned checkout.
      prisma.checkoutSession.aggregate({
        where: { status: CheckoutStatus.COMPLETED },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

  const succeeded = runs - blockedRuns;
  const successRate = runs === 0 ? null : Math.round((succeeded / runs) * 100);

  const tiles = [
    { label: 'إجمالي التسجيلات', value: String(users), sub: `${newUsers} خلال ٣٠ يومًا` },
    { label: 'اشتراكات فعّالة', value: String(activeSubs), sub: 'ACTIVE / TRIALING / PAST_DUE' },
    {
      label: 'الإيرادات المحصّلة',
      value: money(revenue._sum.amount ?? 0),
      sub: `${revenue._count} عملية مكتملة`,
    },
    {
      label: 'نجاح تشغيل الوكلاء',
      value: successRate === null ? '—' : `${successRate}%`,
      sub: runs === 0 ? 'لا توجد تشغيلات بعد' : `${succeeded} من ${runs} · ${blockedRuns} محجوبة بالسياسة`,
    },
    { label: 'بانتظار الاعتماد', value: String(pending), sub: 'لم تُرسل بعد' },
  ];

  return (
    <div className="space-y-6 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">الإدارة</h1>
        <p className="text-white/60 mt-1">
          أرقام حقيقية من قاعدة البيانات — لا تقديرات
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-2xl border border-white/10 bg-white/5 p-5"
          >
            <p className="text-sm text-white/50">{t.label}</p>
            <p className="text-3xl font-bold text-white mt-2">{t.value}</p>
            <p className="text-xs text-white/35 mt-1">{t.sub}</p>
          </div>
        ))}
      </div>

      {revenue._count === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm text-white/60">
            لا توجد مدفوعات مكتملة بعد. تُحتسب العملية هنا فقط بعد webhook
            مُتحقَّق من توقيعه — العودة من متصفح PayPal وحدها لا تكفي.
          </p>
        </div>
      )}
    </div>
  );
}
