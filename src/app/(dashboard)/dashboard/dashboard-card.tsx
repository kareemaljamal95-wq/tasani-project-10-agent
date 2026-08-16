'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

interface DashboardCardProps {
  title: string;
  nameAr: string;
  href: string;
  icon: LucideIcon;
  description: string;
  color: string;
}

export function DashboardCard({ title, href, icon: Icon, description, color }: DashboardCardProps) {
  return (
    <Link href={href}>
      <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 hover:bg-white/10 transition-all duration-300">
        <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-5 transition-opacity`} />
        <div className="relative">
          <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${color}/20 border border-white/10`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
          <p className="text-sm text-white/60">{description}</p>
        </div>
      </div>
    </Link>
  );
}
