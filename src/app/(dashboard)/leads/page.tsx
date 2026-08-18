import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { listLeads } from '@/lib/leads';
import { prisma } from '@/lib/prisma';
import { LeadsBoard } from './leads-board';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'العملاء المحتملون' };

export default async function LeadsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [leads, counts] = await Promise.all([
    listLeads(session.userId, { limit: 100 }),
    prisma.lead.groupBy({
      by: ['status'],
      where: { userId: session.userId },
      _count: { status: true },
    }),
  ]);

  return (
    <LeadsBoard
      initialLeads={leads.map((lead) => ({
        id: lead.id,
        companyName: lead.companyName,
        contactName: lead.contactName,
        email: lead.email,
        status: lead.status,
        score: lead.score,
        assignedAgent: lead.assignedAgent,
        createdAt: lead.createdAt.toISOString(),
      }))}
      counts={Object.fromEntries(counts.map((c) => [c.status, c._count.status]))}
    />
  );
}
