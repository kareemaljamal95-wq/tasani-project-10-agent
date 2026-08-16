'use client';

import { Calendar, CheckCircle, TrendingUp, Brain } from 'lucide-react';

const stats = [
  { icon: Calendar, label: 'Tasks Today', value: '12', change: '+3', color: 'text-violet-400' },
  { icon: CheckCircle, label: 'Completed', value: '48', change: '+12', color: 'text-green-400' },
  { icon: TrendingUp, label: 'Revenue', value: '$12.4k', change: '+18%', color: 'text-amber-400' },
  { icon: Brain, label: 'Memories', value: '1,234', change: '+56', color: 'text-blue-400' },
];

export function QuickStats() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center">
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </div>
              <span className="text-xs text-green-400 font-medium">{stat.change}</span>
            </div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-white/40 mt-1">{stat.label}</p>
          </div>
        );
      })}
    </div>
  );
}
