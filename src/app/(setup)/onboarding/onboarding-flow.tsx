'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Bot, ShieldCheck, User } from 'lucide-react';

type Step = 'profile' | 'agents' | 'approvals';

const STEPS: Step[] = ['profile', 'agents', 'approvals'];

const STEP_META: Record<Step, { title: string; icon: typeof User }> = {
  profile: { title: 'حسابك', icon: User },
  agents: { title: 'وكلاؤك', icon: Bot },
  approvals: { title: 'الاعتماد', icon: ShieldCheck },
};

/**
 * Three steps, ending at a first useful action.
 *
 * Progress is saved to the server on each step rather than held in component
 * state, so closing the tab mid-flow resumes where it stopped.
 */
export function OnboardingFlow({
  initialStep,
  profile,
  agentsProvisioned,
  providers,
}: {
  initialStep: Step;
  profile: { name: string | null; timezone: string; language: string };
  agentsProvisioned: number;
  providers: Record<string, boolean>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [name, setName] = useState(profile.name ?? '');
  const [timezone, setTimezone] = useState(profile.timezone);
  const [provisioned, setProvisioned] = useState(agentsProvisioned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anyProvider = Object.values(providers).some(Boolean);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'تعذّر الحفظ.');
        return null;
      }

      return data;
    } catch {
      setError('تعذّر الاتصال بالخادم.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    const data = await post({
      action: 'save_step',
      step: 'profile',
      name: name || undefined,
      timezone,
    });
    if (data) setStep('agents');
  }

  async function provisionAgents() {
    const data = await post({ action: 'provision_agents' });
    if (data) {
      setProvisioned(data.agentsProvisioned ?? provisioned);
      await post({ action: 'save_step', step: 'agents' });
      setStep('approvals');
    }
  }

  async function finish() {
    const data = await post({ action: 'complete' });
    if (data?.completed) {
      router.push('/agents');
      router.refresh();
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in">
      <div>
        <h1 className="text-3xl font-bold text-white">لنجهّز حسابك</h1>
        <p className="text-white/60 mt-1">ثلاث خطوات قصيرة حتى أول إجراء فعلي.</p>
      </div>

      <ol className="flex items-center gap-3">
        {STEPS.map((s, i) => {
          const Icon = STEP_META[s].icon;
          const done = STEPS.indexOf(step) > i;
          const active = step === s;

          return (
            <li key={s} className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
                  active
                    ? 'border-violet-500/50 bg-violet-500/15 text-violet-200'
                    : done
                      ? 'border-green-500/40 bg-green-500/10 text-green-300'
                      : 'border-white/10 bg-white/5 text-white/30'
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span
                className={`text-sm ${active ? 'text-white' : 'text-white/40'}`}
              >
                {STEP_META[s].title}
              </span>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-white/10" />}
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
        {step === 'profile' && (
          <>
            <p className="text-white/70 text-sm">
              نستخدم هذه المعلومات في صياغة الرسائل وتوقيت الإجراءات.
            </p>
            <Input
              label="اسمك"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="كريم"
            />
            <Input
              label="المنطقة الزمنية"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Riyadh"
            />
            <Button onClick={saveProfile} isLoading={busy} disabled={busy}>
              التالي
            </Button>
          </>
        )}

        {step === 'agents' && (
          <>
            <p className="text-white/70 text-sm">
              سنُهيّئ فريق وكلاء متخصص لحسابك: تنفيذي، مبيعات، تسويق، محتوى،
              بحث، مالي، عمليات، ودعم.
            </p>

            {!anyProvider && (
              <p className="text-sm text-amber-300">
                لا يوجد مفتاح مزوّد مُهيّأ بعد. يمكنك إكمال الإعداد الآن،
                وستعمل الوكلاء فور إضافة مفتاح.
              </p>
            )}

            {provisioned > 0 && (
              <p className="text-sm text-green-300">
                تم تهيئة {provisioned} وكيل.
              </p>
            )}

            <Button onClick={provisionAgents} isLoading={busy} disabled={busy}>
              {provisioned > 0 ? 'متابعة' : 'تهيئة الوكلاء'}
            </Button>
          </>
        )}

        {step === 'approvals' && (
          <>
            <p className="text-white/70 text-sm leading-relaxed">
              الوكلاء يقترحون ولا يرسلون. أي إجراء يخرج من شركتك — رسالة، عرض،
              التزام مالي — يصل إلى صفحة <strong>الموافقات</strong> أولًا،
              وتعتمده أو تعدّله أو ترفضه. الإرسال زر منفصل عن الاعتماد حتى لا
              تُرسل رسالة بالخطأ.
            </p>
            <Button onClick={finish} isLoading={busy} disabled={busy}>
              إنهاء وبدء أول مهمة
            </Button>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
