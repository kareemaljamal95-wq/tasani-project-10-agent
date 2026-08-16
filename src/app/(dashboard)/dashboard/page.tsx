import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import QuickStats from '@/components/dashboard/QuickStats';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const userId = session.userId;

  const [totalTasks, completedTasks, memoryCount, activeGoals, pendingApprovals] =
    await Promise.all([
      prisma.task.count({ where: { userId } }),
      prisma.task.count({ where: { userId, status: 'COMPLETED' } }),
      prisma.memory.count({ where: { userId } }),
      prisma.goal.count({ where: { userId, status: 'ACTIVE' } }),
      prisma.approval.count({ where: { userId, status: 'PENDING' } }),
    ]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold text-white">مرحباً بك في Tasami OS</h1>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <QuickStats label="المهام الكلية" value={totalTasks} icon="tasks" />
        <QuickStats label="المهام المنجزة" value={completedTasks} icon="check" />
        <QuickStats label="الذاكرة النشطة" value={memoryCount} icon="brain" />
        <QuickStats label="الأهداف الحالية" value={activeGoals} icon="target" />
        <QuickStats label="بانتظار موافقتك" value={pendingApprovals} icon="check" />
      </div>
    </div>
  );
}
