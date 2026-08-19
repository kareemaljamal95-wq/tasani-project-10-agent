'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatAmount } from '@/lib/billing/catalog';

interface PlanCard {
  code: string;
  name: string;
  description: string;
  highlighted: boolean;
  features: string[];
  annualSaving: number;
  monthly: number;
  yearly: number;
}

/**
 * Pricing table.
 *
 * The prices rendered here are for display. Checkout sends a plan code and an
 * interval and nothing else — the amount charged is resolved server-side from
 * the catalog, so editing this component's numbers in a browser changes what
 * is shown and not what is billed.
 */
export function PricingTable({
  plans,
  offer,
  signedIn,
}: {
  plans: PlanCard[];
  offer: { code: string; name: string; description: string } | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [annual, setAnnual] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(planCode: string) {
    setError(null);

    if (!signedIn) {
      router.push(`/register?plan=${planCode}&interval=${annual ? 'YEAR' : 'MONTH'}`);
      return;
    }

    setBusy(planCode);

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          planCode,
          interval: annual ? 'YEAR' : 'MONTH',
          ...(offer ? { offerCode: offer.code } : {}),
          // Stable per plan+interval so a double-click or a refresh reuses the
          // same checkout rather than creating a second order.
          idempotencyKey: `checkout-${planCode}-${annual ? 'year' : 'month'}-${Date.now()
            .toString()
            .slice(0, 8)}`,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? 'تعذّر بدء عملية الدفع.');
        return;
      }

      window.location.href = data.approvalUrl;
    } catch {
      setError('تعذّر الاتصال بالخادم.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 py-16 px-4">
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-white">
            من فرصة إلى مشروع
          </h1>
          <p className="text-white/60 max-w-2xl mx-auto leading-relaxed">
            تسامي يكتشف الفرص في سوقك، يحوّلها إلى عملاء محتملين، ويصيغ رسائل
            التواصل — ولا يُرسل شيئًا قبل اعتمادك.
          </p>

          <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            <button
              onClick={() => setAnnual(false)}
              aria-pressed={!annual}
              className={`px-4 py-2 rounded-lg text-sm transition-all ${
                !annual ? 'bg-white/10 text-white' : 'text-white/50'
              }`}
            >
              شهري
            </button>
            <button
              onClick={() => setAnnual(true)}
              aria-pressed={annual}
              className={`px-4 py-2 rounded-lg text-sm transition-all ${
                annual ? 'bg-white/10 text-white' : 'text-white/50'
              }`}
            >
              سنوي
              <span className="text-green-400 mr-1.5">
                وفّر {plans[0]?.annualSaving ?? 17}%
              </span>
            </button>
          </div>
        </header>

        {offer && (
          <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4 text-center">
            <p className="flex items-center justify-center gap-2 text-violet-200 text-sm">
              <Sparkles className="h-4 w-4" />
              <strong>{offer.name}</strong> — {offer.description}
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-center text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
          {plans.map((plan) => {
            const amount = annual ? plan.yearly : plan.monthly;

            return (
              <div
                key={plan.code}
                className={`rounded-2xl border p-6 space-y-5 ${
                  plan.highlighted
                    ? 'border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30 lg:-mt-3 lg:pb-9'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                {plan.highlighted && (
                  <span className="inline-block rounded-full bg-violet-500 px-3 py-1 text-xs font-medium text-white">
                    الأكثر اختيارًا
                  </span>
                )}

                <div>
                  <h2 className="text-xl font-semibold text-white">{plan.name}</h2>
                  <p className="text-sm text-white/50 mt-1 min-h-[2.5rem]">
                    {plan.description}
                  </p>
                </div>

                <div>
                  <span className="text-3xl font-bold text-white">
                    {formatAmount(amount)}
                  </span>
                  <span className="text-white/40 text-sm">
                    {annual ? ' / سنة' : ' / شهر'}
                  </span>
                  {annual && (
                    <p className="text-xs text-green-400 mt-1">
                      يعادل {formatAmount(Math.round(plan.yearly / 12))} شهريًا
                    </p>
                  )}
                </div>

                <Button
                  onClick={() => choose(plan.code)}
                  isLoading={busy === plan.code}
                  disabled={busy !== null}
                  variant={plan.highlighted ? 'primary' : 'secondary'}
                  className="w-full"
                >
                  {signedIn ? 'ابدأ الآن' : 'إنشاء حساب'}
                </Button>

                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-white/70">
                      <Check className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
            <div>
              <h2 className="text-xl font-semibold text-white">Enterprise</h2>
              <p className="text-sm text-white/50 mt-1 min-h-[2.5rem]">
                متطلبات خاصة، أمان، وتكاملات مخصّصة.
              </p>
            </div>

            <div>
              <span className="text-3xl font-bold text-white">تواصل معنا</span>
            </div>

            <Link href="mailto:sales@tasami.ai" className="block">
              <Button variant="secondary" className="w-full">
                تحدّث مع المبيعات
              </Button>
            </Link>

            <ul className="space-y-2">
              {['مقاعد غير محدودة', 'اتفاقية مستوى خدمة', 'تكاملات مخصّصة', 'دعم مخصّص'].map(
                (feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-white/70">
                    <Check className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                    {feature}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>

        <p className="text-center text-xs text-white/30">
          جميع الأسعار بالدولار الأمريكي. لا تُحتسب ضرائب أو رسوم إضافية في هذه
          المرحلة.
        </p>
      </div>
    </div>
  );
}
