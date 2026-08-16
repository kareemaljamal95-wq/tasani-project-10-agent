import { redirect } from 'next/navigation';
import { Brain } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الذاكرة' };

const TYPE_LABEL: Record<string, string> = {
  FACT: 'حقيقة',
  PREFERENCE: 'تفضيل',
  GOAL: 'هدف',
  SKILL: 'مهارة',
  CONVERSATION: 'محادثة',
};

/**
 * Memory store.
 *
 * Previously listed invented documents ("Q1 Strategy Report.pdf",
 * "Competitor Analysis.xlsx") that no upload feature ever produced. This reads
 * the Memory model, which is the store the agents actually retrieve from.
 */
export default async function BrainPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const userId = session.userId;

  const [memories, total, byType] = await Promise.all([
    prisma.memory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.memory.count({ where: { userId } }),
    prisma.memory.groupBy({
      by: ['type'],
      where: { userId },
      _count: { type: true },
    }),
  ]);

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">الذاكرة</h1>
        <p className="text-white/60 mt-1">
          ما يتذكّره النظام عنك ويستخدمه وكلاؤك في قراراتهم
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5">
          <Brain className="h-5 w-5 mb-3 text-violet-400" />
          <p className="text-2xl font-bold text-white">{total}</p>
          <p className="text-xs text-white/40 mt-1">إجمالي العناصر</p>
        </div>

        {byType.slice(0, 3).map((group) => (
          <div
            key={group.type}
            className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5"
          >
            <p className="text-2xl font-bold text-white">{group._count.type}</p>
            <p className="text-xs text-white/40 mt-1">
              {TYPE_LABEL[group.type] ?? group.type}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">أحدث ما تم تذكّره</h2>

        {memories.length === 0 ? (
          <p className="text-white/50 text-sm">
            الذاكرة فارغة. كل ما يتعلّمه النظام من محادثاتك سيظهر هنا، ويمكنك
            حذف أي عنصر في أي وقت.
          </p>
        ) : (
          <ul className="space-y-3">
            {memories.map((memory) => (
              <li key={memory.id} className="p-4 rounded-xl bg-white/5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs text-violet-300">
                    {TYPE_LABEL[memory.type] ?? memory.type}
                  </span>
                  <span className="text-xs text-white/30">
                    {memory.createdAt.toLocaleDateString('ar')}
                  </span>
                </div>
                <p className="text-sm text-white/85">{memory.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
