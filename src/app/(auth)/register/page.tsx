'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bot } from 'lucide-react';

export default function RegisterPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // TODO: implement auth
    setTimeout(() => setIsLoading(false), 2000);
  };

  return (
    <div className="relative z-10 w-full max-w-md mx-auto px-4">
      <div className="text-center mb-8">
        <div className="flex justify-center mb-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 shadow-xl shadow-violet-500/25">
            <Bot className="h-8 w-8 text-white" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white">Create your account</h1>
        <p className="text-white/60 mt-2">Start your journey with KARMISH</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input id="firstName" label="First Name" placeholder="Ahmed" />
            <Input id="lastName" label="Last Name" placeholder="Al-sayed" />
          </div>
          <Input id="email" type="email" label="Email" placeholder="you@example.com" autoComplete="email" />
          <Input id="password" type="password" label="Password" placeholder="••••••••" autoComplete="new-password" />
          <Input id="confirmPassword" type="password" label="Confirm Password" placeholder="••••••••" autoComplete="new-password" />

          <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
            Create Account
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-white/40">
          Already have an account?{' '}
          <Link href="/login" className="text-violet-400 hover:text-violet-300 font-medium">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
