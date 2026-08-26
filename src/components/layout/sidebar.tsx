'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Brain, Calendar, TrendingUp, Briefcase, ShoppingCart, Sparkles, LayoutDashboard, ChevronLeft, CreditCard, ShieldCheck, Users, X, Workflow, Globe } from 'lucide-react';

/**
 * Navigation, grouped by what the product actually is.
 *
 * The flat list put Tasami's own loop — prospects, the site you deliver them,
 * and the approval that gates every outbound message — in the same undifferen-
 * tiated column as six pages inherited from a generic "AI OS" template. A new
 * customer read thirteen equal items and saw a template; the thing that makes
 * this product different was buried in the middle of it.
 *
 * Three groups now, in the order the work happens. The inherited pages keep
 * working and stay reachable, but they no longer compete for first read.
 */
const navGroups: {
  label: string | null;
  items: { href: string; icon: typeof LayoutDashboard; label: string }[];
}[] = [
  {
    label: null,
    items: [{ href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' }],
  },
  {
    // The loop: find a prospect, build what you sell them, approve what goes out.
    label: 'العمل',
    items: [
      { href: '/leads', icon: Users, label: 'Leads' },
      { href: '/sites', icon: Globe, label: 'Sites' },
      { href: '/approvals', icon: ShieldCheck, label: 'Approvals' },
      { href: '/automations', icon: Workflow, label: 'Automations' },
      { href: '/agents', icon: Bot, label: 'Agents' },
    ],
  },
  {
    label: 'مساحات',
    items: [
      { href: '/executive', icon: Calendar, label: 'Executive' },
      { href: '/sales', icon: TrendingUp, label: 'Sales' },
      { href: '/brain', icon: Brain, label: 'Brain' },
      { href: '/growth', icon: Sparkles, label: 'Growth' },
      { href: '/business', icon: Briefcase, label: 'Business' },
      { href: '/commerce', icon: ShoppingCart, label: 'Commerce' },
    ],
  },
  {
    label: 'الحساب',
    items: [{ href: '/billing', icon: CreditCard, label: 'Billing' }],
  },
];

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
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
            <span className="font-bold text-white">TASAMI</span>
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
      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {(isAdmin
          ? [
              ...navGroups,
              {
                label: null,
                items: [{ href: '/admin', icon: ShieldCheck, label: 'Admin' }],
              },
            ]
          : navGroups
        ).map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`} className="space-y-1">
            {/* The heading is decoration when collapsed to icons, so it goes. */}
            {group.label && !collapsed && (
              <p className="px-3 pb-1 text-[11px] uppercase tracking-[0.16em] text-white/25">
                {group.label}
              </p>
            )}

            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined}>
                  <div
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                      active
                        ? 'bg-violet-500/20 text-violet-300'
                        : 'text-white/50 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
