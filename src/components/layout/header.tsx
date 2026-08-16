'use client';

import { Bell, Search } from 'lucide-react';

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-4 lg:px-8 h-16 bg-gray-950/80 backdrop-blur-xl border-b border-white/10">
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <Search className="h-4 w-4 text-white/40" />
        <input
          type="text"
          placeholder="Search anything..."
          className="w-full bg-transparent text-sm text-white placeholder-white/30 outline-none"
        />
      </div>
      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-xl hover:bg-white/5 transition-all">
          <Bell className="h-5 w-5 text-white/60" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-violet-500" />
        </button>
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-xs font-bold text-white">
          A
        </div>
      </div>
    </header>
  );
}
