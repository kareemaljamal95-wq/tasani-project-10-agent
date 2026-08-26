import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getEntitlements } from '@/lib/billing/entitlements';
import { listSites, THEMES } from '@/lib/sitegen';
import { SitesBoard } from './sites-board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'المواقع' };

export default async function SitesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [sites, entitlements] = await Promise.all([
    listSites(session.userId),
    getEntitlements(session.userId),
  ]);

  return (
    <SitesBoard
      active={entitlements.active}
      limit={entitlements.limits['sites.monthly']}
      themes={THEMES.map((t) => ({ id: t.id, label: t.label, note: t.note }))}
      initialSites={sites.map((s) => ({
        id: s.id,
        name: s.name,
        theme: s.theme,
        createdAt: s.createdAt.toISOString(),
        missing:
          (s.profile as { missing?: string[] } | null)?.missing ?? [],
      }))}
    />
  );
}
