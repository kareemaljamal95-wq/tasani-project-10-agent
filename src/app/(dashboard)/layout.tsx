import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileNav } from '@/components/layout/mobile-nav';
import { getSession } from '@/lib/auth/session';

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

  return (
    <div className="min-h-screen bg-gray-950">
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        <main className="p-4 lg:p-8 pb-20 lg:pb-8">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
