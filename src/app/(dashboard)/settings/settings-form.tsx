'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';

interface AgentRow {
  id: string;
  type: string;
  name: string;
  model: string;
  temperature: number;
  isEnabled: boolean;
}

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  configured: boolean;
}

export function SettingsForm({
  initial,
  agents,
  providers,
  models,
  outreachConfigured,
}: {
  initial: {
    email: string;
    name: string | null;
    language: string;
    theme: string;
    timezone: string;
    manualOverride: boolean;
  };
  agents: AgentRow[];
  providers: Record<string, boolean>;
  models: ModelOption[];
  outreachConfigured: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [agentRows, setAgentRows] = useState(agents);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: form.name,
          language: form.language,
          theme: form.theme,
          timezone: form.timezone,
          manualOverride: form.manualOverride,
          agents: agentRows.map((a) => ({
            id: a.id,
            model: a.model,
            temperature: a.temperature,
            isEnabled: a.isEnabled,
          })),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'تعذّر الحفظ.');
        return;
      }

      setSaved(true);
      // Re-fetches the server components so the saved state is what is shown.
      router.refresh();
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 animate-in max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-white">الإعدادات</h1>
        <p className="text-white/60 mt-1">حسابك وتفضيلاتك وإعداد الوكلاء</p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">الحساب</h2>

        <Input label="البريد الإلكتروني" value={form.email} disabled readOnly />

        <Input
          label="الاسم"
          value={form.name ?? ''}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1.5 block">
            <span className="block text-sm font-medium text-white/80">اللغة</span>
            <select
              value={form.language}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none"
            >
              <option value="AR">العربية</option>
              <option value="EN">English</option>
            </select>
          </label>

          <label className="space-y-1.5 block">
            <span className="block text-sm font-medium text-white/80">المظهر</span>
            <select
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none"
            >
              <option value="DARK">داكن</option>
              <option value="LIGHT">فاتح</option>
              <option value="SYSTEM">حسب النظام</option>
            </select>
          </label>

          <Input
            label="المنطقة الزمنية"
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">مزوّدو الذكاء الاصطناعي</h2>
        <p className="text-white/45 text-sm">
          تُضبط المفاتيح في متغيرات البيئة على الخادم ولا تُعرض هنا إطلاقًا.
        </p>

        <ul className="space-y-2">
          {Object.entries(providers).map(([name, configured]) => (
            <li
              key={name}
              className="flex items-center justify-between p-3 rounded-xl bg-white/5"
            >
              <span className="text-sm text-white/85 font-mono">{name}</span>
              {configured ? (
                <span className="flex items-center gap-1.5 text-xs text-green-300">
                  <CheckCircle2 className="h-4 w-4" />
                  مُهيّأ
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-white/35">
                  <XCircle className="h-4 w-4" />
                  غير مُهيّأ
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className="text-xs text-white/35">
          الإرسال الخارجي: {outreachConfigured ? 'مُفعّل' : 'غير مُفعّل'}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">الوكلاء</h2>

        {agentRows.length === 0 ? (
          <p className="text-white/50 text-sm">لم تُهيَّأ الوكلاء بعد.</p>
        ) : (
          <ul className="space-y-3">
            {agentRows.map((agent) => (
              <li
                key={agent.id}
                className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center p-3 rounded-xl bg-white/5"
              >
                <span className="text-sm text-white/85">{agent.name}</span>

                <select
                  value={agent.model}
                  aria-label={`نموذج ${agent.name}`}
                  onChange={(e) =>
                    setAgentRows((rows) =>
                      rows.map((r) =>
                        r.id === agent.id ? { ...r, model: e.target.value } : r,
                      ),
                    )
                  }
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.configured ? '' : ' (مفتاح غير مُهيّأ)'}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-2 text-sm text-white/60">
                  <input
                    type="checkbox"
                    checked={agent.isEnabled}
                    onChange={(e) =>
                      setAgentRows((rows) =>
                        rows.map((r) =>
                          r.id === agent.id
                            ? { ...r, isEnabled: e.target.checked }
                            : r,
                        ),
                      )
                    }
                  />
                  مُفعّل
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-6 space-y-3">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-400" />
          السيادة
        </h2>

        <label className="flex items-start gap-3 text-sm text-white/80">
          <input
            type="checkbox"
            checked={form.manualOverride}
            onChange={(e) =>
              setForm({ ...form, manualOverride: e.target.checked })
            }
            className="mt-1"
          />
          <span>
            التحكّم اليدوي الكامل — عند تفعيله يتطلب <strong>كل</strong> إجراء
            اعتمادك، حتى ما يقع ضمن ميزانية الوكيل.
          </span>
        </label>
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {saved && <p className="text-sm text-green-400">تم الحفظ.</p>}

      <Button onClick={save} isLoading={saving} disabled={saving}>
        حفظ التغييرات
      </Button>
    </div>
  );
}
