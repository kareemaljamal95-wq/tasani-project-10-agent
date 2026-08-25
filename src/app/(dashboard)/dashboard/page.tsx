import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Users, ShieldCheck, Sparkles, Target, Trophy } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/session';
import { getEntitlements } from '@/lib/billing/entitlements';
import { getUsage } from '@/lib/billing/usage';
import { GRADE_THRESHOLDS } from '@/lib/lead-scoring';
import { StatCard } from './stat-card';

export const dynamic = 'force-dynamic';

/**
 * The account's working state.
 *
 * Shows what this product is actually about — prospects, the approvals waiting
 * on the owner, and what the subscription has left — rather than the tasks and
 * memory counters this page used to carry, which no other screen referenced.
 *
 * Every figure is a real count for this account, scoped by userId like every
 * other query here. A new account reads zero everywhere, and says why, because
 * an invented number on a dashboard is the one thing this codebase does not do.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const userId = session.userId;

  // Grades are score ranges, so they count in the database rather than pulling
  // every lead into memory to classify it.
  const [
    leadCount,
    gradeA,
    pendingApprovals,
    sentApprovals,
    wonLeads,
    entitlements,
    usage,
    recent,
  ] = await Promise.all([
    prisma.lead.count({ where: { userId } }),
    prisma.lead.count({ where: { userId, score: { gte: GRADE_THRESHOLDS.A } } }),
    prisma.approval.count({ where: { userId, status: 'PENDING' } }),
    prisma.approval.count({ where: { userId, status: 'SENT' } }),
    prisma.lead.count({ where: { userId, status: 'WON' } }),
    getEntitlements(userId),
    getUsage(userId),
    prisma.activity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, message: true, createdAt: true },
    }),
  ]);

  const remaining = entitlements.active ? usage.remaining : 0;

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">مرحباً بك في Tasami</h1>
        <p className="mt-1 text-white/55">
          {entitlements.active
            ? `خطة ${entitlements.planName} — فريقك جاهز، وكل إجراء خارجي ينتظر اعتمادك`
            : 'اختر خطة لتفعيل فريق الوكلاء'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="العملاء المحتملون"
          value={leadCount}
          hint={leadCount === 0 ? 'ابدأ بمسح سوق' : undefined}
          icon={Users}
          tone="brand"
          href="/leads"
          delayMs={0}
        />
        <StatCard
          label="فرص قوية (A)"
          value={gradeA}
          hint={leadCount > 0 && gradeA === 0 ? 'لا فرصة من الدرجة A بعد' : undefined}
          icon={Target}
          tone={gradeA > 0 ? 'green' : 'neutral'}
          href="/leads"
          delayMs={60}
        />
        <StatCard
          label="بانتظار اعتمادك"
          value={pendingApprovals}
          hint={pendingApprovals > 0 ? 'لن يخرج شيء قبل موافقتك' : undefined}
          icon={ShieldCheck}
          tone={pendingApprovals > 0 ? 'amber' : 'neutral'}
          href="/approvals"
          delayMs={120}
        />
        <StatCard
          label="أُرسل بعد الاعتماد"
          value={sentApprovals}
          icon={Trophy}
          tone={wonLeads > 0 ? 'green' : 'neutral'}
          href="/approvals"
          delayMs={180}
        />
        <StatCard
          label="إجراءات متبقية"
          value={entitlements.active ? remaining : '—'}
          hint={
            entitlements.active
              ? `من ${usage.limit} هذا الشهر`
              : 'يحتاج اشتراكًا نشطًا'
          }
          icon={Sparkles}
          tone={entitlements.active ? 'brand' : 'neutral'}
          href="/billing"
          delayMs={240}
        />
      </div>

      <section className="rise rounded-2xl border border-white/10 bg-white/5 p-5" style={{ animationDelay: '300ms' }}>
        <h2 className="mb-3 text-sm font-semibold text-white/70">آخر ما جرى</h2>

        {recent.length === 0 ? (
          <p className="text-sm text-white/40">
            لا نشاط بعد.{' '}
            <Link href="/leads" className="text-violet-300 underline">
              أضف أول عميل محتمل
            </Link>{' '}
            ثم شغّل عليه وكيلًا.
          </p>
        ) : (
          <ul className="space-y-2">
            {recent.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0 truncate text-white/75">{a.message}</span>
                <span className="shrink-0 text-xs tabular-nums text-white/30">
                  {new Date(a.createdAt).toLocaleDateString('ar')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
