'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Bot, Sparkles } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';

const ThreeCanvas = dynamic(() => import('@/components/landing/ThreeCanvas'), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-full bg-[#0A0B12] flex items-center justify-center">
      <div className="agent-glow-sphere" />
    </div>
  ),
});

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      const maxScroll = el.scrollHeight - el.clientHeight;
      setScrollProgress(Math.min(el.scrollTop / maxScroll, 1));
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div ref={containerRef} className="h-screen w-full overflow-y-auto snap-y snap-mandatory bg-[#0A0B12]">
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-purple-600">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold text-white/90">TASAMI OS</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-white/60 hover:text-white transition-colors">
            Sign In
          </Link>
          <Link
            href="/register"
            className="rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all"
          >
            Get Started
          </Link>
        </div>
      </div>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`h-2 w-2 rounded-full transition-all duration-300 ${
              scrollProgress > i / 3 && scrollProgress < (i + 1) / 3 + 0.1
                ? 'bg-violet-400 w-6'
                : 'bg-white/20'
            }`}
          />
        ))}
      </div>

      <ThreeCanvas />
    </div>
  );
}
