import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getLead, LeadNotFoundError } from '@/lib/leads';
import { listLeadActivities } from '@/lib/activity';
import { prisma } from '@/lib/prisma';
import { LeadDetail } from './lead-detail';

export const dynamic = 'force-dynamic';

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;

  try {
    // Scoped by userId inside the service: another account's lead id is
    // indistinguishable from one that does not exist.
    const lead = await getLead(id, session.userId);

    const [activities, approvals] = await Promise.all([
      listLeadActivities(id, session.userId),
      prisma.approval.findMany({
        where: { leadId: id, userId: session.userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return (
      <LeadDetail
        lead={{
          id: lead.id,
          companyName: lead.companyName,
          contactName: lead.contactName,
          email: lead.email,
          phone: lead.phone,
          website: lead.website,
          notes: lead.notes,
          status: lead.status,
          score: lead.score,
          assignedAgent: lead.assignedAgent,
          createdAt: lead.createdAt.toISOString(),
          lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
        }}
        activities={activities.map((a) => ({
          id: a.id,
          type: a.type,
          message: a.message,
          actor: a.actor,
          createdAt: a.createdAt.toISOString(),
        }))}
        approvals={approvals.map((a) => ({
          id: a.id,
          status: a.status,
          objective: a.objective,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    );
  } catch (error) {
    if (error instanceof LeadNotFoundError) notFound();
    throw error;
  }
}
