'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Bot } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const ThreeCanvas = dynamic(() => import('@/components/landing/ThreeCanvas'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 z-0 bg-[#0A0B12]" />,
});

/**
 * Landing page.
 *
 * Two layers, and the separation is the whole fix. The 3D scene is a fixed,
 * inert backdrop at z-0; every word and every control is ordinary DOM at z-10,
 * stacked vertically by flex.
 *
 * Previously the copy lived inside the canvas as drei `Text` and `Html`, each
 * anchored to a 3D coordinate, and the sections were `position: fixed`. That
 * left the scroll container with no content to scroll — so scroll progress was
 * a division by zero, the camera never moved, and all three scenes rendered
 * their headings simultaneously on top of one another. The sections below give
 * the page real height, which is what makes both the scroll and the camera
 * work.
 */

const SECTIONS = [
  {
    id: 'portal',
    eyebrow: 'Tasami OS',
    title: 'فريق وكلاء يعمل لحسابك',
    body: 'أحد عشر وكيلًا متخصصًا يبحثون في السوق، ويقيّمون الفرص، ويصوغون الرسائل — ويتوقفون عند حدّ واحد لا يتجاوزونه.',
  },
  {
    id: 'rings',
    eyebrow: 'الاكتشاف',
    title: 'من سوق كامل إلى قائمة قابلة للعمل',
    body: 'وكيل الاستكشاف يمسح الأنشطة الحقيقية في منطقتك، ويعطي كل واحد درجة من مئة مبنية على ما نُشر عنه فعلًا — لا على تخمين.',
  },
  {
    id: 'fleet',
    eyebrow: 'البوابة',
    title: 'ولا رسالة تخرج قبل اعتمادك',
    body: 'الوكيل لا يملك طريقًا إلى الإرسال. أقصى ما يستطيعه أن يقترح، ويبقى الاقتراح معلّقًا حتى تقرّر أنت.',
  },
];

export default function LandingPage() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // A ref, not state: this updates on every scroll frame and drives the camera
  // directly. Routing it through state would re-render the page ~60 times a
  // second for a value React never needs to paint.
  const progressRef = useRef(0);
  const [active, setActive] = useState(0);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const max = el.scrollHeight - el.clientHeight;
    // Guard the division that used to produce Infinity when nothing scrolled.
    const p = max > 0 ? Math.min(el.scrollTop / max, 1) : 0;

    progressRef.current = p;
    setActive(Math.min(Math.floor(p * SECTIONS.length + 0.35), SECTIONS.length - 1));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  return (
    <div className="relative h-screen w-full bg-[#0A0B12]">
      <ThreeCanvas progress={progressRef} />

      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-purple-600">
            <Bot className="h-5 w-5 text-white" />
          </span>
          <span className="text-lg font-bold text-white/90">Tasami</span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/login"
            className="rounded-xl px-3 py-2 text-sm text-white/60 transition-colors hover:text-white"
          >
            دخول
          </Link>
          <Link
            href="/register"
            className="rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/25 transition-shadow hover:shadow-violet-500/40 sm:px-5"
          >
            ابدأ الآن
          </Link>
        </nav>
      </header>

      <div
        ref={scrollerRef}
        className="relative z-10 h-screen w-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden"
      >
        {SECTIONS.map((s, i) => (
          <section
            key={s.id}
            className="flex min-h-screen snap-start flex-col items-center justify-center px-6 py-28 text-center sm:px-8"
          >
            <div className="flex max-w-xl flex-col items-center gap-5">
              <p className="text-xs uppercase tracking-[0.25em] text-violet-300/70">
                {s.eyebrow}
              </p>

              <h2 className="text-balance text-3xl font-bold leading-tight text-white drop-shadow-[0_2px_24px_rgba(10,11,18,0.9)] sm:text-5xl">
                {s.title}
              </h2>

              <p className="text-balance text-base leading-relaxed text-white/70 drop-shadow-[0_2px_16px_rgba(10,11,18,0.9)] sm:text-lg">
                {s.body}
              </p>

              {i === SECTIONS.length - 1 && (
                <Link
                  href="/register"
                  className="mt-3 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-shadow hover:shadow-violet-500/50"
                >
                  ابدأ مع فريقك
                </Link>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="pointer-events-none fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2">
        {SECTIONS.map((s, i) => (
          <span
            key={s.id}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === active ? 'w-7 bg-violet-400' : 'w-1.5 bg-white/25'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
