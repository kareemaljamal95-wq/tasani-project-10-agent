'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Play, Trash2, Pencil } from 'lucide-react';
import { WorkflowCanvas } from './workflow-canvas';

export interface TriggerRow {
  id: string;
  name: string;
  enabled: boolean;
  kind: string;
  leadStatus: string | null;
  agentType: string;
  objectiveTemplate: string;
  cooldownHours: number;
  lastRunAt: string | null;
  createdAt: string;
}

export interface RunRow {
  id: string;
  triggerId: string | null;
  status: string;
  createdAt: string;
  finishedAt: string;
  attempts: number;
  lastError: string | null;
}

const LEAD_STATUS: Record<string, string> = {
  NEW: 'جديد',
  CONTACTED: 'تم التواصل',
  QUALIFIED: 'مؤهّل',
  PROPOSAL: 'عرض مقدَّم',
  WON: 'مكسوب',
  LOST: 'مفقود',
};

const RUN_STYLE: Record<string, string> = {
  PENDING: 'bg-white/10 text-white/60 border-white/20',
  RUNNING: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  SUCCEEDED: 'bg-green-500/15 text-green-300 border-green-500/30',
  FAILED: 'bg-red-500/15 text-red-300 border-red-500/30',
  CANCELLED: 'bg-white/10 text-white/40 border-white/20',
};

const RUN_LABEL: Record<string, string> = {
  PENDING: 'بالانتظار',
  RUNNING: 'قيد التشغيل',
  SUCCEEDED: 'نجحت',
  FAILED: 'فشلت',
  CANCELLED: 'أُلغيت',
};

function when(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function AutomationsBoard({
  initialTriggers,
  runs,
  agents,
  enabledCount,
  limit,
  planName,
  active,
}: {
  initialTriggers: TriggerRow[];
  runs: RunRow[];
  agents: { type: string; label: string }[];
  enabledCount: number;
  limit: number;
  planName: string | null;
  active: boolean;
}) {
  const router = useRouter();
  const [triggers, setTriggers] = useState(initialTriggers);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TriggerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atLimit = enabledCount >= limit;

  async function call(method: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/automation/triggers', {
        method,
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 402 is the entitlement refusal; it carries the plan's own wording,
        // so it is shown rather than replaced with a generic failure.
        setError(data.error ?? 'تعذّر تنفيذ العملية.');
        return null;
      }

      router.refresh();
      return data;
    } catch {
      setError('تعذّر الاتصال بالخادم.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const leadStatus = String(f.get('leadStatus') ?? '');

    const data = await call('POST', {
      name: String(f.get('name') ?? ''),
      kind: 'lead_status',
      agentType: String(f.get('agentType') ?? ''),
      objectiveTemplate: String(f.get('objectiveTemplate') ?? ''),
      cooldownHours: Number(f.get('cooldownHours') ?? 24),
      ...(leadStatus ? { leadStatus } : {}),
    });

    if (data?.trigger) {
      setTriggers((prev) => [data.trigger, ...prev]);
      setAdding(false);
    }
  }

  async function saveEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const f = new FormData(e.currentTarget);

    const data = await call('PATCH', {
      id: editing.id,
      name: String(f.get('name') ?? ''),
      objectiveTemplate: String(f.get('objectiveTemplate') ?? ''),
      cooldownHours: Number(f.get('cooldownHours') ?? 24),
    });

    if (data?.trigger) {
      setTriggers((prev) =>
        prev.map((t) => (t.id === editing.id ? data.trigger : t)),
      );
      setEditing(null);
    }
  }

  async function toggle(t: TriggerRow) {
    const data = await call('PATCH', { id: t.id, enabled: !t.enabled });
    if (data?.trigger) {
      setTriggers((prev) =>
        prev.map((x) => (x.id === t.id ? data.trigger : x)),
      );
    }
  }

  async function runNow(t: TriggerRow) {
    // Goes through evaluateTrigger — the same path the scheduled worker uses,
    // so a manual run inherits policy, the approval gate and the audit trail.
    await call('PATCH', { id: t.id, runNow: true });
  }

  async function remove(t: TriggerRow) {
    if (!confirm(`حذف الأتمتة "${t.name}"؟ لا يمكن التراجع.`)) return;
    const data = await call('DELETE', { id: t.id });
    if (data?.deleted) {
      setTriggers((prev) => prev.filter((x) => x.id !== t.id));
    }
  }

  const field =
    'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white';

  return (
    <div className="space-y-6 animate-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">الأتمتة</h1>
          <p className="text-white/60 mt-1">
            المُشغّل يضع المهمة في الطابور — والتنفيذ يمر بنفس بوابة الاعتماد
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-white/50">
            {enabledCount} / {limit} نشطة
          </span>
          <Button
            onClick={() => {
              setEditing(null);
              setAdding((v) => !v);
            }}
            disabled={!active}
          >
            <Plus className="h-4 w-4 ml-1" />
            أتمتة جديدة
          </Button>
        </div>
      </div>

      {!active && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-200">
            الأتمتة تحتاج اشتراكًا نشطًا.{' '}
            <a href="/billing" className="underline">
              اختر خطة
            </a>
          </p>
        </div>
      )}

      {active && atLimit && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-200">
            بلغت الحد الأقصى لخطة {planName ?? 'الحالية'} ({limit} أتمتة نشطة).
            عطّل واحدة أو{' '}
            <a href="/billing" className="underline">
              رقِّ خطتك
            </a>
            .
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {(adding || editing) && (
        <form
          onSubmit={editing ? saveEdit : create}
          className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              name="name"
              label="اسم الأتمتة"
              required
              defaultValue={editing?.name}
            />
            <Input
              name="cooldownHours"
              type="number"
              min={1}
              max={720}
              label="فترة التهدئة (ساعات)"
              defaultValue={String(editing?.cooldownHours ?? 24)}
            />

            {!editing && (
              <>
                <label className="block">
                  <span className="text-sm text-white/60 mb-1 block">الوكيل</span>
                  <select name="agentType" required className={field}>
                    {agents.map((a) => (
                      <option key={a.type} value={a.type} className="bg-[#0A0B12]">
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm text-white/60 mb-1 block">
                    يعمل على العملاء في حالة
                  </span>
                  <select name="leadStatus" className={field}>
                    <option value="" className="bg-[#0A0B12]">
                      كل الحالات
                    </option>
                    {Object.entries(LEAD_STATUS).map(([v, l]) => (
                      <option key={v} value={v} className="bg-[#0A0B12]">
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          <label className="block">
            <span className="text-sm text-white/60 mb-1 block">
              الهدف — استخدم {'{{company}}'} و {'{{status}}'}
            </span>
            <textarea
              name="objectiveTemplate"
              required
              minLength={5}
              rows={2}
              defaultValue={editing?.objectiveTemplate}
              className={field}
              placeholder="اكتب رسالة تعريفية أولى إلى {{company}}"
            />
          </label>

          <div className="flex gap-2">
            <Button type="submit" isLoading={busy} disabled={busy}>
              حفظ
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setEditing(null);
              }}
            >
              إلغاء
            </Button>
          </div>
        </form>
      )}

      {triggers.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
          <p className="text-white/60">لا توجد أتمتة بعد.</p>
          <p className="text-white/35 text-sm mt-2">
            أنشئ أتمتة تُشغّل وكيلًا على عملائك تلقائيًا — وكل رسالة خارجية تظل
            بانتظار اعتمادك.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {triggers.map((t) => {
            const last = runs.filter((r) => r.triggerId === t.id).slice(0, 3);
            return (
              <li
                key={t.id}
                className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">{t.name}</p>
                    <p className="text-xs text-white/40 truncate">
                      {t.agentType} ·{' '}
                      {t.leadStatus ? LEAD_STATUS[t.leadStatus] : 'كل الحالات'} ·
                      كل {t.cooldownHours}س · آخر تشغيل {when(t.lastRunAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggle(t)}
                      disabled={busy}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        t.enabled
                          ? 'bg-green-500/15 text-green-300 border-green-500/30'
                          : 'bg-white/10 text-white/50 border-white/20'
                      }`}
                    >
                      {t.enabled ? 'نشطة' : 'متوقفة'}
                    </button>

                    <button
                      onClick={() => runNow(t)}
                      disabled={busy}
                      title="تشغيل الآن"
                      className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10"
                    >
                      <Play className="h-4 w-4" />
                    </button>

                    <button
                      onClick={() => {
                        setAdding(false);
                        setEditing(t);
                      }}
                      title="تعديل"
                      className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    <button
                      onClick={() => remove(t)}
                      disabled={busy}
                      title="حذف"
                      className="p-2 rounded-lg text-white/50 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-white/50 line-clamp-2">
                  {t.objectiveTemplate}
                </p>

                <WorkflowCanvas
                  trigger={t}
                  leadStatusLabel={LEAD_STATUS}
                  onEdit={() => {
                    setAdding(false);
                    setEditing(t);
                  }}
                />

                {last.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                    {last.map((r) => (
                      <span
                        key={r.id}
                        title={r.lastError ?? undefined}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                          RUN_STYLE[r.status] ?? RUN_STYLE.PENDING
                        }`}
                      >
                        {RUN_LABEL[r.status] ?? r.status} · {when(r.createdAt)}
                        {r.attempts > 1 ? ` · ${r.attempts} محاولات` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
