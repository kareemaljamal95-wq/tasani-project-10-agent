import { ShoppingCart, Package, TrendingUp, DollarSign } from 'lucide-react';

export default function CommercePage() {
  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">Commerce Assistant</h1>
        <p className="text-white/60 mt-1">Product research, store management, and sales optimization</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: DollarSign, label: 'Total Sales', value: '$89,230', change: '+15.3%', color: 'text-green-400' },
          { icon: Package, label: 'Products', value: '342', change: '+12', color: 'text-blue-400' },
          { icon: TrendingUp, label: 'Conversion', value: '4.8%', change: '+0.6%', color: 'text-violet-400' },
          { icon: ShoppingCart, label: 'Orders', value: '2,847', change: '+342', color: 'text-amber-400' },
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
          <h2 className="text-lg font-semibold text-white mb-4">Top Products</h2>
          <div className="space-y-3">
            {[
              { name: 'Premium Widget Pro', sales: 847, revenue: '$42,350' },
              { name: 'Eco Bundle Pack', sales: 523, revenue: '$15,690' },
              { name: 'Smart Dashboard', sales: 341, revenue: '$23,870' },
              { name: 'Analytics Suite', sales: 234, revenue: '$18,720' },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                <div>
                  <p className="text-sm text-white font-medium">{p.name}</p>
                  <p className="text-xs text-white/40">{p.sales} sales</p>
                </div>
                <span className="text-sm text-green-400">{p.revenue}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Sales Funnel</h2>
          <div className="space-y-3">
            {[
              { stage: 'Impressions', value: '45,230', pct: 100 },
              { stage: 'Clicks', value: '3,847', pct: 8.5 },
              { stage: 'Add to Cart', value: '1,234', pct: 2.7 },
              { stage: 'Purchases', value: '847', pct: 1.9 },
            ].map((f) => (
              <div key={f.stage}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-white/80">{f.stage}</span>
                  <span className="text-white/40">{f.value} ({f.pct}%)</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-purple-600" style={{ width: `${f.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
