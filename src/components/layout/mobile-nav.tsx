'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Brain, Calendar, TrendingUp, Briefcase, ShoppingCart, Sparkles, LayoutDashboard } from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { href: '/executive', icon: Calendar, label: 'Executive' },
  { href: '/business', icon: Briefcase, label: 'Business' },
  { href: '/commerce', icon: ShoppingCart, label: 'Commerce' },
  { href: '/sales', icon: TrendingUp, label: 'Sales' },
  { href: '/brain', icon: Brain, label: 'Brain' },
  { href: '/growth', icon: Sparkles, label: 'Growth' },
  { href: '/agents', icon: Bot, label: 'Agents' },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-gray-950/90 backdrop-blur-xl border-t border-white/10">
      <div className="flex items-center justify-around px-2 py-2">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${active ? 'text-violet-400' : 'text-white/40'}`}>
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
