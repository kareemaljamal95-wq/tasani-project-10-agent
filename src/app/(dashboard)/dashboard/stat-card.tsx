import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/**
 * One dashboard figure.
 *
 * A server component: nothing here needs state, and the entrance animation is
 * CSS, so this ships no JavaScript at all. The previous card rendered its icon
 * as a text emoji, which is why the dashboard read as unfinished.
 *
 * `tone` is a closed set rather than a free class string so a caller cannot
 * invent a colour that means nothing in the design system.
 */

export type Tone = 'brand' | 'amber' | 'green' | 'neutral';

const TONE: Record<Tone, { ring: string; icon: string; glow: string }> = {
  brand: {
    ring: 'border-violet-500/25',
    icon: 'text-violet-300',
    glow: 'from-blue-500/15 to-violet-500/15',
  },
  amber: {
    ring: 'border-amber-500/30',
    icon: 'text-amber-300',
    glow: 'from-amber-500/15 to-amber-500/5',
  },
  green: {
    ring: 'border-green-500/25',
    icon: 'text-green-300',
    glow: 'from-green-500/15 to-green-500/5',
  },
  neutral: {
    ring: 'border-white/10',
    icon: 'text-white/50',
    glow: 'from-white/10 to-transparent',
  },
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  href,
  delayMs = 0,
}: {
  label: string;
  value: number | string;
  /** Short line under the figure. Say what is missing rather than nothing. */
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  href?: string;
  delayMs?: number;
}) {
  const t = TONE[tone];

  const body = (
    <div
      className={`group relative h-full overflow-hidden rounded-2xl border ${t.ring} bg-white/5 p-5 transition-colors hover:bg-white/[0.08]`}
    >
      <div
        className={`pointer-events-none absolute -left-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${t.glow} blur-2xl`}
        aria-hidden
      />
      <div className="relative">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-white/45">{label}</span>
          <Icon className={`h-4 w-4 ${t.icon}`} aria-hidden />
        </div>
        <p className="text-3xl font-bold tabular-nums text-white">{value}</p>
        {hint && <p className="mt-1 text-xs text-white/35">{hint}</p>}
      </div>
    </div>
  );

  return (
    <div className="rise h-full" style={{ animationDelay: `${delayMs}ms` }}>
      {href ? (
        <Link href={href} className="block h-full">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
