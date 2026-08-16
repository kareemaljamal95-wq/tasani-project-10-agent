import { Sparkles, TrendingUp, BookOpen, Target, Zap, Clock } from 'lucide-react';

export default function GrowthPage() {
  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Personal Growth Coach</h1>
        <p className="text-white/60 mt-1">Habit tracking, skill development, and productivity coaching</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Zap, label: 'Current Streak', value: '12 days', change: '+1', color: 'text-orange-400' },
          { icon: BookOpen, label: 'Skills Active', value: '5', change: '+2', color: 'text-blue-400' },
          { icon: Target, label: 'Goals Completed', value: '8', change: '+3', color: 'text-green-400' },
          { icon: Clock, label: 'Focus Hours', value: '124h', change: '+18h', color: 'text-violet-400' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
              <span className="text-xs text-green-400">{stat.change}</span>
            </div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-white/40 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-400" />
            Daily Habits
          </h2>
          <div className="space-y-3">
            {[
              { name: 'Morning Meditation', done: true, streak: 12 },
              { name: 'Read for 30 minutes', done: true, streak: 8 },
              { name: 'Exercise', done: false, streak: 5 },
              { name: 'Review Daily Goals', done: true, streak: 12 },
              { name: 'Journal Writing', done: false, streak: 3 },
            ].map((habit) => (
              <div key={habit.name} className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                <div className="flex items-center gap-3">
                  <div className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all ${habit.done ? 'bg-green-500 border-green-500' : 'border-white/20'}`}>
                    {habit.done && <span className="text-white text-xs">✓</span>}
                  </div>
                  <span className={`text-sm ${habit.done ? 'text-white/60 line-through' : 'text-white'}`}>{habit.name}</span>
                </div>
                <span className="text-xs text-white/40">{habit.streak} day streak</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-violet-400" />
              Skills in Progress
            </h2>
            <div className="space-y-4">
              {[
                { name: 'TypeScript', level: 75, target: 100 },
                { name: 'Public Speaking', level: 45, target: 80 },
                { name: 'Leadership', level: 60, target: 90 },
              ].map((skill) => (
                <div key={skill.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-white/80">{skill.name}</span>
                    <span className="text-white/40">{skill.level}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-purple-600" style={{ width: `${(skill.level / skill.target) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-violet-400" />
              Learning Path
            </h2>
            <div className="space-y-3">
              {[
                { course: 'Advanced AI Patterns', progress: 60, lessons: '12/20' },
                { course: 'Business Strategy', progress: 35, lessons: '7/20' },
                { course: 'Growth Hacking', progress: 80, lessons: '16/20' },
              ].map((course) => (
                <div key={course.course} className="p-3 rounded-xl bg-white/5">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-white">{course.course}</span>
                    <span className="text-white/40">{course.lessons}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-purple-600" style={{ width: `${course.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
