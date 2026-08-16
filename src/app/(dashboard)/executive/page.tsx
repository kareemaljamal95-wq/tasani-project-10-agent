import { redirect } from 'next/navigation';
import { Calendar, ListTodo, Target } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'المساعد التنفيذي' };

/**
 * Executive assistant.
 *
 * The schedule was a string array ("9:00 AM - Team Standup"), the goals were
 * hardcoded percentages. All three panels now read the CalendarEvent, Task and
 * Goal models for the signed-in account.
 */
export default async function ExecutivePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const userId = session.userId;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [events, tasks, goals] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { userId, startDate: { gte: dayStart, lt: dayEnd } },
      orderBy: { startDate: 'asc' },
    }),
    prisma.task.findMany({
      where: { userId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 10,
    }),
    prisma.goal.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
  ]);

  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">المساعد التنفيذي</h1>
        <p className="text-white/60 mt-1">جدولك ومهامك وأهدافك في مكان واحد</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <Calendar className="h-5 w-5 text-violet-400" />
              جدول اليوم
            </h2>

            {events.length === 0 ? (
              <p className="text-white/50 text-sm">لا توجد مواعيد اليوم.</p>
            ) : (
              <ul className="space-y-3">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center gap-4 p-3 rounded-xl bg-white/5"
                  >
                    <div className="h-2 w-2 rounded-full bg-violet-400 shrink-0" />
                    <span className="text-sm text-white/80">
                      {event.isAllDay
                        ? 'طوال اليوم'
                        : event.startDate.toLocaleTimeString('ar', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                      — {event.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <ListTodo className="h-5 w-5 text-blue-400" />
              المهام المفتوحة
            </h2>

            {tasks.length === 0 ? (
              <p className="text-white/50 text-sm">لا توجد مهام مفتوحة.</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white/5"
                  >
                    <span className="text-sm text-white/80 truncate">
                      {task.title}
                    </span>
                    <span className="text-xs text-white/35 shrink-0">
                      {task.priority}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 h-fit">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
            <Target className="h-5 w-5 text-green-400" />
            الأهداف النشطة
          </h2>

          {goals.length === 0 ? (
            <p className="text-white/50 text-sm">لا توجد أهداف نشطة.</p>
          ) : (
            <ul className="space-y-4">
              {goals.map((goal) => (
                <li key={goal.id}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-white/80 truncate">{goal.title}</span>
                    <span className="text-white/40 shrink-0">
                      {goal.progress}%
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full bg-white/10 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={goal.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-green-400"
                      style={{ width: `${Math.min(goal.progress, 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
