import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileNav } from '@/components/layout/mobile-nav';
import { getSession } from '@/lib/auth/session';
import { isAdminEmail } from '@/lib/auth/admin';
import { prisma } from '@/lib/prisma';

/**
 * Server-side gate for the whole dashboard group.
 *
 * Every page under (dashboard) renders only after this layout resolves, so an
 * unauthenticated visitor is redirected before any tenant data is queried.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) redirect('/login');

  // Unfinished accounts are sent to setup before any dashboard surface loads.
  // Onboarding lives in the (setup) group, outside this layout, so this
  // redirect cannot loop back into itself.
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { onboardingCompletedAt: true },
  });

  if (user && !user.onboardingCompletedAt) redirect('/onboarding');

  return (
    <div className="min-h-screen bg-gray-950">
      <Sidebar isAdmin={isAdminEmail(session.email)} />
      <div className="lg:pl-64">
        <Header />
        <main className="p-4 lg:p-8 pb-20 lg:pb-8">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
