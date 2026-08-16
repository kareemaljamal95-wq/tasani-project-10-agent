import { redirect } from 'next/navigation';
import { Zap, Target, CheckCircle2, Flame } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'النمو' };

/**
 * Growth coach.
 *
 * Streaks, active skills, completed goals and focus hours were all hardcoded
 * ("12 days", "124h"). These read the Habit and Goal models; a new account
 * correctly shows zeros.
 */
export default async function GrowthPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const userId = session.userId;

  const [habits, activeGoals, completedGoals] = await Promise.all([
    prisma.habit.findMany({
      where: { userId, isActive: true },
      orderBy: { streak: 'desc' },
    }),
    prisma.goal.count({ where: { userId, status: 'ACTIVE' } }),
    prisma.goal.count({ where: { userId, status: 'COMPLETED' } }),
  ]);

  const bestStreak = habits.reduce((max, h) => Math.max(max, h.streak), 0);
  const totalCompletions = habits.reduce(
    (sum, h) => sum + h.totalCompletions,
    0,
  );

  const stats = [
    { icon: Flame, label: 'أطول سلسلة حالية', value: `${bestStreak} يوم`, color: 'text-orange-400' },
    { icon: Zap, label: 'عادات نشطة', value: String(habits.length), color: 'text-blue-400' },
    { icon: Target, label: 'أهداف نشطة', value: String(activeGoals), color: 'text-violet-400' },
    { icon: CheckCircle2, label: 'أهداف مكتملة', value: String(completedGoals), color: 'text-green-400' },
  ];

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">النمو</h1>
        <p className="text-white/60 mt-1">تتبّع العادات والأهداف والتقدّم</p>
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

      <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">العادات</h2>

        {habits.length === 0 ? (
          <p className="text-white/50 text-sm">
            لا توجد عادات مُتتبَّعة بعد. أضف عادة لتبدأ في بناء سلسلة.
          </p>
        ) : (
          <ul className="space-y-3">
            {habits.map((habit) => (
              <li
                key={habit.id}
                className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white/5"
              >
                <span className="text-sm text-white/85 truncate">
                  {habit.name}
                </span>
                <span className="text-xs text-white/45 shrink-0">
                  {habit.streak} يوم متتالٍ · {habit.totalCompletions} مرة
                </span>
              </li>
            ))}
          </ul>
        )}

        {totalCompletions > 0 && (
          <p className="text-xs text-white/30 mt-4">
            إجمالي مرات الإنجاز: {totalCompletions}
          </p>
        )}
      </section>
    </div>
  );
}
