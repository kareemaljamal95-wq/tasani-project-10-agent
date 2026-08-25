'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Settles the checkout while the customer waits.
 *
 * The page itself still grants nothing — this asks the server to ask PayPal,
 * and only a provider-confirmed payment activates anything. It exists because a
 * webhook that is delayed or never configured would otherwise leave a customer
 * who has genuinely paid staring at "waiting for confirmation" forever.
 *
 * Polls a few times and then stops. An indefinite poll would hammer the
 * provider on behalf of an order that was simply abandoned.
 */
const ATTEMPTS = 5;
const GAP_MS = 4000;

export function Reconcile({ checkoutId }: { checkoutId: string }) {
  const router = useRouter();
  const [exhausted, setExhausted] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Guards the double-invoke React does in development, which would
    // otherwise fire two capture attempts at the provider.
    if (started.current) return;
    started.current = true;

    let cancelled = false;

    (async () => {
      for (let i = 0; i < ATTEMPTS && !cancelled; i += 1) {
        try {
          const res = await fetch('/api/billing/reconcile', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ checkoutId }),
          });

          const data = await res.json().catch(() => ({}));

          if (data.outcome === 'activated' || data.outcome === 'already-active') {
            router.refresh();
            return;
          }
        } catch {
          // Network hiccup; the next attempt covers it.
        }

        await new Promise((r) => setTimeout(r, GAP_MS));
      }

      if (!cancelled) setExhausted(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [checkoutId, router]);

  if (!exhausted) return null;

  return (
    <p className="text-xs text-white/35">
      لم يصل تأكيد الدفع بعد. إن كنت قد أتممت الدفع، حدّث الصفحة بعد قليل — لا
      يُفعَّل الاشتراك إلا بعد تأكيد المزوّد.
    </p>
  );
}
