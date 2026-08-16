import { redirect } from 'next/navigation';
import { TrendingUp, Users, Target, CheckCircle2 } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'المبيعات' };

/**
 * Sales overview.
 *
 * Every figure on this page previously came from a hardcoded array —
 * "48 Active Leads", "$184k Pipeline Value", and a pipeline listing
 * TechCorp Inc. and DataFlow Systems. None of it was connected to anything.
 * The numbers below are real counts for the signed-in account, which means a
 * new account correctly sees zeros rather than a fabricated pipeline.
 */
export default async function SalesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const userId = session.userId;

  const [proposed, approved, sent, runs] = await Promise.all([
    prisma.approval.count({ where: { userId, agentId: 'SALES' } }),
    prisma.approval.count({
      where: { userId, agentId: 'SALES', status: 'APPROVED' },
    }),
    prisma.approval.count({
      where: { userId, agentId: 'SALES', status: 'SENT' },
    }),
    prisma.agentRun.count({ where: { userId, agentId: 'SALES' } }),
  ]);

  const recent = await prisma.approval.findMany({
    where: { userId, agentId: 'SALES' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const stats = [
    { icon: Users, label: 'مقترحات المبيعات', value: proposed, color: 'text-blue-400' },
    { icon: Target, label: 'معتمدة', value: approved, color: 'text-green-400' },
    { icon: TrendingUp, label: 'أُرسلت', value: sent, color: 'text-violet-400' },
    { icon: CheckCircle2, label: 'عمليات تشغيل الوكيل', value: runs, color: 'text-amber-400' },
  ];

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">وكيل المبيعات</h1>
        <p className="text-white/60 mt-1">
          تأهيل العملاء المحتملين وإدارة المسار حتى الإغلاق
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5"
          >
            <stat.icon className={`h-5 w-5 mb-3 ${stat.color}`} />
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-white/40 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">أحدث المقترحات</h2>

        {recent.length === 0 ? (
          <p className="text-white/50 text-sm">
            لا توجد مقترحات بعد. شغّل وكيل المبيعات من صفحة الوكلاء لإنشاء أول
            مقترح، وسيصلك للاعتماد قبل أي إرسال.
          </p>
        ) : (
          <ul className="space-y-3">
            {recent.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/5"
              >
                <span className="text-sm text-white/85 truncate">
                  {item.objective}
                </span>
                <span className="text-xs text-white/40 shrink-0">
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
