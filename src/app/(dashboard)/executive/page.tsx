import { Calendar, ListTodo, Target, Clock } from 'lucide-react';

export default function ExecutivePage() {
  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Executive Assistant</h1>
        <p className="text-white/60 mt-1">Manage your calendar, tasks, goals, and daily planning</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Calendar className="h-5 w-5 text-violet-400" />
                Today&apos;s Schedule
              </h2>
            </div>
            <div className="space-y-3">
              {['9:00 AM - Team Standup', '10:30 AM - Strategy Review', '2:00 PM - Client Call', '4:00 PM - Planning Session'].map((event, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                  <div className="h-2 w-2 rounded-full bg-violet-400" />
                  <span className="text-sm text-white/80">{event}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <ListTodo className="h-5 w-5 text-violet-400" />
                Tasks
              </h2>
            </div>
            <div className="space-y-2">
              {['Review quarterly report', 'Prepare investor deck', 'Update product roadmap', 'Review team OKRs'].map((task, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-all">
                  <input type="checkbox" className="rounded border-white/10 bg-white/5" />
                  <span className="text-sm text-white/70">{task}</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${i < 2 ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                    {i < 2 ? 'Urgent' : 'High'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Target className="h-5 w-5 text-violet-400" />
                Goals
              </h2>
            </div>
            <div className="space-y-4">
              {[
                { name: 'Q2 Revenue Target', progress: 65 },
                { name: 'Product Launch', progress: 40 },
                { name: 'Team Expansion', progress: 80 },
              ].map((goal) => (
                <div key={goal.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-white/80">{goal.name}</span>
                    <span className="text-white/40">{goal.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-purple-600 transition-all" style={{ width: `${goal.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-violet-400" />
              <h2 className="text-lg font-semibold text-white">Reminders</h2>
            </div>
            <div className="space-y-2">
              {['Review budget at 3pm', 'Send weekly report', 'Prepare for tomorrow'].map((r, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-white/5 text-sm text-white/70">
                  {r}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
