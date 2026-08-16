interface QuickStatsProps {
  label: string;
  value: number | string;
  icon: string;
}

const iconMap: Record<string, string> = {
  tasks: '📋',
  check: '✅',
  brain: '🧠',
  target: '🎯',
};

export default function QuickStats({ label, value, icon }: QuickStatsProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{iconMap[icon] || '📊'}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-white/40 mt-1">{label}</p>
    </div>
  );
}
