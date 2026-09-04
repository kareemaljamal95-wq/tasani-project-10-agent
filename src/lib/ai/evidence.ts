import { LeadStatus, JobStatus, ApprovalStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { GRADE_THRESHOLDS } from '@/lib/lead-scoring';

/**
 * What an agent is allowed to know before it decides.
 *
 * Every agent shared one weakness: it reasoned over an objective string and
 * nothing else. Eleven agents, one prompt each, no access to the account they
 * were advising — so eleven of them produced opinions and none produced work
 * grounded in anything. Given no facts, a model supplies its own, which is the
 * one thing this product refuses to ship.
 *
 * This is the read side of that fix. Each agent type declares the slice of the
 * owner's real data it reasons over; the slice is fetched here, scoped by
 * `userId`, and handed to the model as fenced task data. Nothing here writes,
 * sends, or spends — the approval gate stays exactly where it was.
 *
 * Two rules hold everywhere below:
 *
 *  - **Absence is stated, never omitted.** An account with no leads reports
 *    `leads: 0`, not a missing key. A silently absent field invites the model
 *    to fill it in, which is how invented figures reach a customer's screen.
 *  - **Everything is bounded.** Counts over rows, and at most a handful of
 *    examples. An agent that reasons over ten thousand leads costs ten
 *    thousand leads' worth of tokens and reasons no better for it.
 */

export type Evidence = Record<string, unknown>;

/** How many example rows any single source may include. */
const SAMPLE = 5;

const period = () => new Date().toISOString().slice(0, 7);

/** Counts leads per status, always reporting every status including zeroes. */
async function leadFunnel(userId: string) {
  const rows = await prisma.lead.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  });

  const counts = Object.fromEntries(
    Object.values(LeadStatus).map((s) => [s, 0]),
  ) as Record<string, number>;

  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

/** Opportunity grades, derived from the same thresholds the UI displays. */
async function gradeCounts(userId: string) {
  const [a, b, total] = await Promise.all([
    prisma.lead.count({ where: { userId, score: { gte: GRADE_THRESHOLDS.A } } }),
    prisma.lead.count({
      where: {
        userId,
        score: { gte: GRADE_THRESHOLDS.B, lt: GRADE_THRESHOLDS.A },
      },
    }),
    prisma.lead.count({ where: { userId } }),
  ]);

  return { A: a, B: b, C: total - a - b, total };
}

/**
 * The strongest opportunities, with the reasons the scorer recorded.
 *
 * The reasons matter more than the score: they are what lets an agent argue
 * from evidence ("no published website, 312 reviews") instead of asserting a
 * number the owner cannot check.
 */
async function topLeads(userId: string) {
  const leads = await prisma.lead.findMany({
    where: { userId },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    take: SAMPLE,
    select: {
      companyName: true,
      status: true,
      score: true,
      website: true,
      phone: true,
      email: true,
      rating: true,
      ratingCount: true,
      lastContactedAt: true,
    },
  });

  return leads.map((l) => ({
    company: l.companyName,
    status: l.status,
    score: l.score,
    hasWebsite: Boolean(l.website),
    reachableBy: [l.phone && 'phone', l.email && 'email'].filter(Boolean),
    rating: l.rating,
    ratingCount: l.ratingCount,
    contactedBefore: Boolean(l.lastContactedAt),
  }));
}

async function usage(userId: string) {
  const counters = await prisma.usageCounter.findMany({
    where: { userId, periodKey: period() },
    select: { metric: true, count: true },
  });

  return {
    periodKey: period(),
    metered: counters.length
      ? Object.fromEntries(counters.map((c) => [c.metric, c.count]))
      : {},
    note: counters.length ? undefined : 'nothing metered this period yet',
  };
}

async function approvalState(userId: string) {
  const rows = await prisma.approval.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  });

  const counts = Object.fromEntries(
    Object.values(ApprovalStatus).map((s) => [s, 0]),
  ) as Record<string, number>;

  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

async function queueState(userId: string) {
  const [rows, failures, triggers] = await Promise.all([
    prisma.job.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.job.findMany({
      where: { userId, status: JobStatus.FAILED },
      orderBy: { updatedAt: 'desc' },
      take: SAMPLE,
      select: { kind: true, attempts: true, lastError: true },
    }),
    prisma.automationTrigger.findMany({
      where: { userId },
      select: { name: true, kind: true, enabled: true, lastRunAt: true },
      take: 20,
    }),
  ]);

  const counts = Object.fromEntries(
    Object.values(JobStatus).map((s) => [s, 0]),
  ) as Record<string, number>;

  for (const row of rows) counts[row.status] = row._count._all;

  return {
    jobs: counts,
    // Truncated: an error string is provider output and can be long.
    recentFailures: failures.map((f) => ({
      kind: f.kind,
      attempts: f.attempts,
      error: f.lastError?.slice(0, 200) ?? null,
    })),
    triggers,
  };
}

/**
 * Delivered sites and, more usefully, what each is still missing.
 *
 * The gap list is the actionable half: a site with four unfilled fields is a
 * concrete thing to go and ask the owner for.
 */
async function siteState(userId: string) {
  const sites = await prisma.generatedSite.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: SAMPLE,
    select: { name: true, theme: true, profile: true, createdAt: true },
  });

  const total = await prisma.generatedSite.count({ where: { userId } });

  return {
    total,
    recent: sites.map((s) => {
      const profile = s.profile as { missing?: string[] } | null;
      return {
        name: s.name,
        theme: s.theme,
        missingFields: profile?.missing ?? [],
      };
    }),
  };
}

async function subscriptionState(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      status: true,
      interval: true,
      amount: true,
      currency: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      plan: { select: { code: true, name: true } },
    },
  });

  return sub
    ? {
        plan: sub.plan?.code ?? null,
        status: sub.status,
        interval: sub.interval,
        // Minor units, as everywhere else. Naming it prevents a model
        // reporting 14900 as fourteen thousand dollars.
        amountMinorUnits: sub.amount,
        currency: sub.currency,
        renewsOn: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      }
    : { plan: null, status: 'none', note: 'no subscription on this account' };
}

async function sourceMix(userId: string) {
  const rows = await prisma.lead.groupBy({
    by: ['source'],
    where: { userId },
    _count: { _all: true },
  });

  return rows.length
    ? Object.fromEntries(rows.map((r) => [r.source ?? 'unknown', r._count._all]))
    : {};
}

/**
 * Which slice each agent reasons over.
 *
 * An agent absent from this map gets `{}` and behaves exactly as it did
 * before, so adding an agent type can never break by omission — it only stays
 * as blind as every agent used to be until it is given a source here.
 */
const SOURCES: Record<string, (userId: string) => Promise<Evidence>> = {
  /** What the line already holds, so intake does not re-accept known work. */
  async INTAKE(userId) {
    const [queue, funnel] = await Promise.all([
      queueState(userId),
      leadFunnel(userId),
    ]);
    return { automation: { jobs: queue.jobs }, ticketsByStatus: funnel };
  },

  async ARCHITECT(userId) {
    return { deliverables: await siteState(userId) };
  },

  async DEVELOPER(userId) {
    return { deliverables: await siteState(userId) };
  },

  async INTEGRATOR(userId) {
    return { automation: await queueState(userId) };
  },

  /** Security reads what has been delivered and what failed on the way. */
  async SECURITY(userId) {
    const [queue, approvals] = await Promise.all([
      queueState(userId),
      approvalState(userId),
    ]);
    return { automation: queue, approvals };
  },

  async QA(userId) {
    const [queue, sites] = await Promise.all([
      queueState(userId),
      siteState(userId),
    ]);
    return { automation: queue, deliverables: sites };
  },

  async ANALYST(userId) {
    const [funnel, queue, sites, approvals, used] = await Promise.all([
      leadFunnel(userId),
      queueState(userId),
      siteState(userId),
      approvalState(userId),
      usage(userId),
    ]);
    return {
      ticketsByStatus: funnel,
      automation: queue,
      deliverables: sites,
      approvals,
      usage: used,
    };
  },

  async DEVOPS(userId) {
    return { automation: await queueState(userId) };
  },

  async DOCS(userId) {
    return { deliverables: await siteState(userId) };
  },

  /** Delivery must see what is waiting on the owner before it packages more. */
  async DELIVERY(userId) {
    const [approvals, sites] = await Promise.all([
      approvalState(userId),
      siteState(userId),
    ]);
    return { approvals, deliverables: sites };
  },

  // Retired consultancy roles. An account provisioned before the pivot still
  // has AgentConfig rows naming these, and an agent with no source here is
  // blind rather than broken — but blind is what the evidence layer exists to
  // end, so they keep their slices until no rows remain.
  async SALES(userId) {
    const [top, funnel, approvals] = await Promise.all([
      topLeads(userId),
      leadFunnel(userId),
      approvalState(userId),
    ]);
    return { topOpportunities: top, leadsByStatus: funnel, approvals };
  },

  async STRATEGIST(userId) {
    const [top, grades, sites] = await Promise.all([
      topLeads(userId),
      gradeCounts(userId),
      siteState(userId),
    ]);
    return { topOpportunities: top, opportunityGrades: grades, sites };
  },

  async DISCOVERY(userId) {
    const [mix, grades] = await Promise.all([
      sourceMix(userId),
      gradeCounts(userId),
    ]);
    return { alreadyImportedBySource: mix, opportunityGrades: grades };
  },

  async CONTENT(userId) {
    return { sites: await siteState(userId) };
  },

  async MARKETING(userId) {
    const [grades, sites, mix] = await Promise.all([
      gradeCounts(userId),
      siteState(userId),
      sourceMix(userId),
    ]);
    return { opportunityGrades: grades, sites, leadSources: mix };
  },

  async OPERATIONS(userId) {
    return { automation: await queueState(userId) };
  },

  async CUSTOMER_SUPPORT(userId) {
    const [approvals, funnel] = await Promise.all([
      approvalState(userId),
      leadFunnel(userId),
    ]);
    return { approvals, leadsByStatus: funnel };
  },

  async RESEARCH(userId) {
    const [mix, grades] = await Promise.all([
      sourceMix(userId),
      gradeCounts(userId),
    ]);
    return { leadSources: mix, opportunityGrades: grades };
  },

  async FINANCE(userId) {
    const [sub, used] = await Promise.all([
      subscriptionState(userId),
      usage(userId),
    ]);
    return { subscription: sub, usage: used };
  },

  async CEO(userId) {
    const [grades, funnel, approvals, sites, sub, queue] = await Promise.all([
      gradeCounts(userId),
      leadFunnel(userId),
      approvalState(userId),
      siteState(userId),
      subscriptionState(userId),
      queueState(userId),
    ]);
    return {
      opportunityGrades: grades,
      leadsByStatus: funnel,
      approvals,
      sites: { total: sites.total },
      subscription: sub,
      automation: { jobs: queue.jobs, triggers: queue.triggers.length },
    };
  },
};

/**
 * Reads the agent's slice of the account.
 *
 * Failure is degraded, not fatal: an agent that cannot read its evidence still
 * decides, and says so, rather than the whole run dying on a slow query. The
 * marker is explicit so the model reports thin ground instead of inventing
 * firm ground.
 */
export async function gatherEvidence(
  agentId: string,
  userId: string,
): Promise<Evidence> {
  const source = SOURCES[agentId];
  if (!source) return {};

  try {
    return { accountData: await source(userId) };
  } catch {
    return { accountData: null, evidenceUnavailable: true };
  }
}

/** Agent types that read real account data. Used by the UI and by tests. */
export const AGENTS_WITH_EVIDENCE = Object.keys(SOURCES);
