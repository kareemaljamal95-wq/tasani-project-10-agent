'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { logout } from '@/lib/auth/client';

/**
 * Account menu with sign-out.
 *
 * The header previously showed a hardcoded "A" avatar and no way to sign out
 * at all, even though /api/auth already accepted a logout action.
 */
export function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setEmail(d?.user?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const initial = (email ?? '?').charAt(0).toUpperCase();

  async function handleLogout() {
    setBusy(true);
    await logout();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="قائمة الحساب"
        className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-xs font-bold text-white"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 mt-2 w-56 rounded-xl border border-white/10 bg-gray-900 shadow-xl p-1.5 z-50"
        >
          {email && (
            <p className="px-3 py-2 text-xs text-white/40 truncate border-b border-white/5 mb-1">
              {email}
            </p>
          )}
          <button
            role="menuitem"
            onClick={handleLogout}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </button>
        </div>
      )}
    </div>
  );
}
