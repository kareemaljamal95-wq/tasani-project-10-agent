'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Brain, Calendar, TrendingUp, Briefcase, ShoppingCart, Sparkles, LayoutDashboard, ChevronLeft, X } from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/executive', icon: Calendar, label: 'Executive' },
  { href: '/business', icon: Briefcase, label: 'Business' },
  { href: '/commerce', icon: ShoppingCart, label: 'Commerce' },
  { href: '/sales', icon: TrendingUp, label: 'Sales' },
  { href: '/brain', icon: Brain, label: 'Brain' },
  { href: '/growth', icon: Sparkles, label: 'Growth' },
  { href: '/agents', icon: Bot, label: 'Agents' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`fixed left-0 top-0 z-40 h-screen hidden lg:flex flex-col bg-gray-950/80 backdrop-blur-xl border-r border-white/10 transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`}>
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-white">KARMISH</span>
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center">
              <Bot className="h-4 w-4 text-white" />
            </div>
          </Link>
        )}
        <button onClick={() => setCollapsed(!collapsed)} className="text-white/40 hover:text-white transition-colors">
          {collapsed ? <X className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${active ? 'bg-violet-500/20 text-violet-300' : 'text-white/50 hover:text-white hover:bg-white/5'}`}>
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </div>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
