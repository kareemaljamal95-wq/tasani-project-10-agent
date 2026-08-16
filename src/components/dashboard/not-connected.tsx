import type { LucideIcon } from 'lucide-react';
import { PlugZap } from 'lucide-react';

/**
 * Honest placeholder for a surface that has no data source yet.
 *
 * Used in place of the fabricated dashboards this project shipped with, where
 * figures such as "$128,430 revenue" and "1,847 customers" were hardcoded
 * arrays with nothing behind them. In a product that is sold to businesses,
 * inventing an owner's numbers is worse than showing none: it cannot be
 * distinguished from real reporting.
 */
export function NotConnected({
  title,
  description,
  requirement,
  icon: Icon = PlugZap,
}: {
  title: string;
  description: string;
  requirement: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">{title}</h1>
        <p className="text-white/60 mt-1">{description}</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-10 text-center">
        <div className="flex justify-center mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
            <Icon className="h-6 w-6 text-white/50" />
          </div>
        </div>

        <h2 className="text-white font-medium">لا يوجد مصدر بيانات مرتبط بعد</h2>

        <p className="text-white/50 text-sm mt-2 max-w-md mx-auto leading-relaxed">
          {requirement}
        </p>

        <p className="text-white/30 text-xs mt-4">
          لن تُعرض هنا أي أرقام قبل ربط مصدر حقيقي.
        </p>
      </div>
    </div>
  );
}
