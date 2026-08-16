import { TrendingUp, Users, DollarSign, Target, Phone, Mail } from 'lucide-react';

export default function SalesPage() {
  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">AI Sales Agent</h1>
        <p className="text-white/60 mt-1">Lead qualification, pipeline management, and closing strategies</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users, label: 'Active Leads', value: '48', change: '+12', color: 'text-blue-400' },
          { icon: Target, label: 'Qualified', value: '23', change: '+5', color: 'text-green-400' },
          { icon: TrendingUp, label: 'Pipeline Value', value: '$184k', change: '+$23k', color: 'text-violet-400' },
          { icon: DollarSign, label: 'Closed This Month', value: '$42k', change: '+18%', color: 'text-amber-400' },
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Pipeline</h2>
            <div className="space-y-3">
              {[
                { name: 'TechCorp Inc.', stage: 'Proposal', value: '$25,000', probability: 70 },
                { name: 'DataFlow Systems', stage: 'Negotiation', value: '$50,000', probability: 85 },
                { name: 'CloudBase Ltd', stage: 'Qualified', value: '$12,000', probability: 45 },
                { name: 'AeroSpace Co', stage: 'Meeting', value: '$35,000', probability: 55 },
              ].map((lead) => (
                <div key={lead.name} className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                  <div>
                    <p className="text-sm font-medium text-white">{lead.name}</p>
                    <p className="text-xs text-white/40">{lead.stage} · {lead.probability}%</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-green-400">{lead.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Phone className="h-5 w-5 text-violet-400" />
              Recent Interactions
            </h2>
            <div className="space-y-3">
              {[
                { type: 'Call', with: 'John from TechCorp', time: '2h ago' },
                { type: 'Email', with: 'Sarah at DataFlow', time: '4h ago' },
                { type: 'Meeting', with: 'Mike - CloudBase', time: 'Yesterday' },
              ].map((interaction, i) => (
                <div key={i} className="p-3 rounded-xl bg-white/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300">{interaction.type}</span>
                    <span className="text-xs text-white/40">{interaction.time}</span>
                  </div>
                  <p className="text-sm text-white/70">{interaction.with}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Mail className="h-5 w-5 text-violet-400" />
              Follow-ups
            </h2>
            <div className="space-y-2">
              {['Follow up with TechCorp', 'Send proposal to DataFlow', 'Schedule demo with CloudBase'].map((f, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-white/5 text-sm text-white/70 flex items-center gap-2">
                  <input type="checkbox" className="rounded border-white/10" />
                  {f}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
