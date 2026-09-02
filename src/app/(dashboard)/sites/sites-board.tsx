'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Download, Trash2, Eye, Sparkles, Link2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Paste a listing, get a site.
 *
 * The gaps are shown as prominently as the result, and that is the point. An
 * owner who sees "3 حقول ناقصة" fills them; an owner shown only a finished-
 * looking page sends it to a customer with invented-looking blanks inside.
 */

const FIELD_LABEL: Record<string, string> = {
  tagline: 'الجملة التعريفية',
  about: 'النبذة',
  services: 'الخدمات',
  prices: 'الأسعار',
  hours: 'ساعات العمل',
  phone: 'الهاتف',
  email: 'البريد',
  address: 'العنوان',
  website: 'الموقع',
  rating: 'التقييم',
};

interface SiteRow {
  id: string;
  name: string;
  theme: string;
  createdAt: string;
  missing: string[];
}

interface ThemeOption {
  id: string;
  label: string;
  note: string;
}

const SAMPLE = `مطعم الواحة الذهبية
4.6 ★ (312)
مطعم شرق أوسطي
شارع التحلية، حي العليا، الرياض
+966 11 456 7890
الأحد - الخميس 12:00 - 23:00
- مندي لحم 85 ر.س
- كبسة دجاج 65 ر.س`;

export function SitesBoard({
  initialSites,
  themes,
  active,
  limit,
}: {
  initialSites: SiteRow[];
  themes: ThemeOption[];
  active: boolean;
  limit: number;
}) {
  const router = useRouter();
  const [sites, setSites] = useState(initialSites);
  const [raw, setRaw] = useState('');
  const [themeId, setThemeId] = useState(themes[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Share links are held per site rather than on the row so revoking one does
  // not require refetching the list.
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  async function build(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ raw, themeId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'تعذّر بناء الموقع.');
        return;
      }

      setSites((prev) => [
        {
          id: data.site.id,
          name: data.site.name,
          theme: data.site.theme,
          createdAt: new Date().toISOString(),
          missing: data.site.missing ?? [],
        },
        ...prev,
      ]);

      setRaw('');
      router.refresh();
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Publishes the page at a link the business owner can open.
   *
   * This is what turns a generated file into something you can send: the
   * prospect has no account here, so a private preview shows them nothing.
   */
  async function share(site: SiteRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ share: true }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'تعذّر إنشاء الرابط.');
        return;
      }

      setLinks((prev) => ({ ...prev, [site.id]: data.url }));

      // Best effort: the clipboard is unavailable over plain http and in some
      // embedded browsers, and the link is shown either way.
      try {
        await navigator.clipboard.writeText(data.url);
        setCopied(site.id);
        setTimeout(() => setCopied(null), 2000);
      } catch {
        /* the link is on screen; copying was a convenience */
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(site: SiteRow) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ share: false }),
      });
      if (res.ok) {
        setLinks((prev) => {
          const next = { ...prev };
          delete next[site.id];
          return next;
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(site: SiteRow) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) setSites((prev) => prev.filter((s) => s.id !== site.id));
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white';

  return (
    <div className="space-y-6 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">المواقع</h1>
        <p className="mt-1 text-white/60">
          الصق بيانات نشاط، واحصل على موقع كامل بملف واحد — والحقول الناقصة
          تظهر كطلبات لا كبيانات مخترعة
        </p>
      </div>

      {!active && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-200">
            بناء المواقع يحتاج اشتراكًا نشطًا.{' '}
            <a href="/billing" className="underline">
              اختر خطة
            </a>
          </p>
        </div>
      )}

      <form
        onSubmit={build}
        className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4"
      >
        <label className="block">
          <span className="mb-1 block text-sm text-white/60">
            بيانات النشاط — انسخها من خرائط Google أو اكتبها بنفسك
          </span>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            required
            minLength={2}
            rows={8}
            dir="auto"
            placeholder={SAMPLE}
            className={`${field} font-mono text-xs leading-relaxed`}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-white/60">الطابع</span>
            <select
              value={themeId}
              onChange={(e) => setThemeId(e.target.value)}
              className={field}
            >
              {themes.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#0A0B12]">
                  {t.label} — {t.note}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <Button type="submit" isLoading={busy} disabled={busy || !active}>
              <Sparkles className="ml-1 h-4 w-4" />
              ابنِ الموقع
            </Button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <p className="text-xs text-white/35">
          {limit > 0 ? `${limit} موقعًا شهريًا في خطتك` : 'يحتاج اشتراكًا نشطًا'}
        </p>
      </form>

      {sites.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
          <p className="text-white/60">لا مواقع بعد.</p>
          <p className="mt-2 text-sm text-white/35">
            أكثر عملائك قيمة هم من لا موقع لهم — وهذا ما تبيعه لهم.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sites.map((site) => (
            <li
              key={site.id}
              className="rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-white">
                    <Globe className="h-4 w-4 text-violet-300" />
                    <span className="truncate">{site.name}</span>
                  </p>
                  <p className="mt-1 text-xs text-white/40">
                    {themes.find((t) => t.id === site.theme)?.label ?? site.theme}
                    {' · '}
                    {new Date(site.createdAt).toLocaleDateString('ar')}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/api/sites/${site.id}`}
                    target="_blank"
                    rel="noopener"
                    title="معاينة"
                    className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
                  >
                    <Eye className="h-4 w-4" />
                  </a>
                  <button
                    onClick={() => share(site)}
                    disabled={busy}
                    title="رابط للعميل"
                    className="rounded-lg p-2 text-white/50 hover:bg-violet-500/10 hover:text-violet-300"
                  >
                    {copied === site.id ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                  </button>
                  <a
                    href={`/api/sites/${site.id}?download=1`}
                    title="تنزيل الملف"
                    className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <button
                    onClick={() => remove(site)}
                    disabled={busy}
                    title="حذف"
                    className="rounded-lg p-2 text-white/50 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {links[site.id] && (
                <div className="mt-3 rounded-xl border border-violet-500/25 bg-violet-500/10 p-3">
                  <p className="mb-2 text-xs text-violet-200/80">
                    رابط جاهز لإرساله لصاحب النشاط — يفتحه بلا حساب:
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-2 py-1 text-[11px] text-white/70">
                      {links[site.id]}
                    </code>
                    <button
                      onClick={() => revoke(site)}
                      disabled={busy}
                      className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/50 hover:text-white"
                    >
                      إلغاء الرابط
                    </button>
                  </div>
                </div>
              )}

              {site.missing.length > 0 && (
                <div className="mt-3 border-t border-white/5 pt-3">
                  <p className="mb-2 text-xs text-amber-200/80">
                    {site.missing.length} حقلًا لم يذكرها المصدر — تظهر في الموقع
                    كطلبات بيانات:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {site.missing.map((m) => (
                      <span
                        key={m}
                        className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200/90"
                      >
                        {FIELD_LABEL[m] ?? m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
