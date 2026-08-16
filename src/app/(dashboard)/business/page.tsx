import { TrendingUp, DollarSign, Users, Target, BarChart3 } from 'lucide-react';

export default function BusinessPage() {
  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Business Operator</h1>
        <p className="text-white/60 mt-1">Strategy, analytics, and growth planning</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: DollarSign, label: 'Revenue', value: '$128,430', change: '+12.5%', color: 'text-green-400' },
          { icon: TrendingUp, label: 'Growth Rate', value: '23.4%', change: '+5.2%', color: 'text-blue-400' },
          { icon: Users, label: 'Customers', value: '1,847', change: '+234', color: 'text-violet-400' },
          { icon: Target, label: 'Conversion', value: '3.2%', change: '+0.8%', color: 'text-amber-400' },
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
            <BarChart3 className="h-5 w-5 text-violet-400" />
            Revenue Overview
          </h2>
          <div className="h-64 flex items-center justify-center text-white/20">
            Revenue Chart Placeholder
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">KPIs</h2>
          <div className="space-y-4">
            {[
              { name: 'Monthly Recurring Revenue', value: '$42,800', target: '$50,000', progress: 86 },
              { name: 'Customer Acquisition Cost', value: '$47', target: '$35', progress: 65 },
              { name: 'Net Promoter Score', value: '72', target: '80', progress: 90 },
            ].map((kpi) => (
              <div key={kpi.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-white/80">{kpi.name}</span>
                  <span className="text-white/40">{kpi.value} / {kpi.target}</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${kpi.progress >= 80 ? 'bg-green-500' : kpi.progress >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${kpi.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
