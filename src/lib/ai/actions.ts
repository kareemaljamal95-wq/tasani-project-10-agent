import { LeadStatus } from '@prisma/client';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { recordAudit } from '@/lib/audit';
import { updateLead } from '@/lib/leads';
import { buildSite } from '@/lib/sitegen';
import { runDiscoveryScan } from '@/lib/discovery/scan';

/**
 * What an agent is allowed to *do*.
 *
 * Reading the account made the agents informed; this makes them useful. An
 * agent may now carry a concrete action alongside its decision, and the system
 * performs it — so a content agent produces a site rather than describing one,
 * and a sales agent moves a lead rather than recommending that someone move it.
 *
 * The boundary is the load-bearing part, and it is narrow on purpose:
 *
 * **Nothing here reaches an outside party.** Every action below writes only
 * inside the owner's own account — a stored file, a status column, imported
 * rows. The approval gate exists to guard what leaves the company, and none of
 * this leaves it, which is the same reasoning that already lets `buildSite`
 * run without an approval. An outward-facing action stays what it always was:
 * a PENDING approval a human releases, and no entry in this file will ever
 * change that.
 *
 * **An agent may only take the actions listed for its type.** The allowlist is
 * enforced here rather than trusted from the model, so an agent that asks for
 * an action outside its role is refused and the refusal is recorded.
 *
 * Entitlement and metering are not re-implemented: each underlying function
 * already checks the plan and reserves the quota, so an agent cannot spend
 * what a person could not.
 */

export const agentActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),

  /** Build a site from listing text the agent was given or assembled. */
  z.object({
    kind: z.literal('build_site'),
    raw: z.string().min(2).max(20_000),
    leadId: z.string().min(1).optional(),
    themeId: z.string().min(1).optional(),
  }),

  /** Move a lead along the funnel. */
  z.object({
    kind: z.literal('set_lead_status'),
    leadId: z.string().min(1),
    status: z.nativeEnum(LeadStatus),
  }),

  /** Import businesses matching a search. */
  z.object({
    kind: z.literal('discovery_scan'),
    query: z.string().min(2).max(200),
    location: z.string().min(2).max(200),
  }),
]);

export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentActionKind = AgentAction['kind'];

/**
 * Which actions each agent type may take.
 *
 * Deliberately tight. An agent type absent from this map can take no action at
 * all and behaves exactly as it did before, so adding an agent never grants a
 * capability by omission — the safe direction to fail in.
 */
const ALLOWED: Record<string, AgentActionKind[]> = {
  // The production line. Only the roles that produce an artefact may write
  // one, and DELIVERY is absent on purpose: handover leaves the company, so it
  // stays a PENDING approval the owner releases.
  DEVELOPER: ['build_site'],
  ARCHITECT: ['build_site'],
  DOCS: ['build_site'],
  INTAKE: ['set_lead_status'],
  QA: ['set_lead_status'],
  SECURITY: ['set_lead_status'],

  // Retired consultancy roles, kept while accounts provisioned before the
  // pivot still hold AgentConfig rows naming them.
  CONTENT: ['build_site'],
  MARKETING: ['build_site'],
  SALES: ['set_lead_status'],
  STRATEGIST: ['set_lead_status'],
  DISCOVERY: ['discovery_scan'],
  OPERATIONS: ['set_lead_status'],
};

export type ActionResult =
  | { performed: false; reason: 'none' }
  | { performed: false; reason: 'not-permitted'; kind: AgentActionKind }
  | { performed: false; reason: 'failed'; kind: AgentActionKind; error: string }
  | { performed: true; kind: AgentActionKind; summary: string };

export interface PerformActionInput {
  userId: string;
  agentId: string;
  actor: string;
  action: AgentAction;
}

/** True when this agent type may take this action. */
export function isPermitted(agentId: string, kind: AgentActionKind): boolean {
  if (kind === 'none') return true;
  return (ALLOWED[agentId] ?? []).includes(kind);
}

/**
 * Performs an agent's action, or explains why it did not.
 *
 * Never throws. A failed action must not lose the decision that accompanied
 * it — the owner still needs to read what the agent concluded, and a failure
 * that erases its own context is worse than one that reports itself.
 */
export async function performAgentAction(
  input: PerformActionInput,
): Promise<ActionResult> {
  const { action, agentId, userId, actor } = input;

  if (action.kind === 'none') return { performed: false, reason: 'none' };

  if (!isPermitted(agentId, action.kind)) {
    logger.warn('Agent action refused: outside this agent\'s role', {
      userId,
      agentId,
      kind: action.kind,
    });

    await recordAudit({
      type: 'agent_action_refused',
      message: `Agent ${agentId} asked for ${action.kind}, which its role does not permit.`,
      data: { agentId, kind: action.kind },
      userId,
      actor,
    }).catch(() => undefined);

    return { performed: false, reason: 'not-permitted', kind: action.kind };
  }

  try {
    const summary = await run(action, userId, actor);

    await recordAudit({
      type: 'agent_action',
      message: `Agent ${agentId} performed ${action.kind}.`,
      data: { agentId, kind: action.kind, summary },
      userId,
      actor,
    });

    logger.info('Agent action performed', { userId, agentId, kind: action.kind });

    return { performed: true, kind: action.kind, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Entitlement, usage limit and provider errors all land here. They are
    // reported rather than rethrown: the run itself succeeded in producing a
    // decision, and that decision is still worth the owner's attention.
    logger.warn('Agent action failed', {
      userId,
      agentId,
      kind: action.kind,
      error: message,
    });

    return {
      performed: false,
      reason: 'failed',
      kind: action.kind,
      error: message.slice(0, 300),
    };
  }
}

async function run(
  action: AgentAction,
  userId: string,
  actor: string,
): Promise<string> {
  switch (action.kind) {
    case 'build_site': {
      const site = await buildSite({
        userId,
        actor,
        raw: action.raw,
        leadId: action.leadId,
        themeId: action.themeId,
      });

      // The gaps are named in the summary because they are the actionable
      // half: the owner needs to know what the source did not say.
      return site.missing.length
        ? `أُنشئ موقع لـ ${site.name}. حقول لم يذكرها المصدر: ${site.missing.join('، ')}.`
        : `أُنشئ موقع لـ ${site.name}.`;
    }

    case 'set_lead_status': {
      // Scoped by userId inside updateLead: a leadId from another account
      // reads as not-found rather than being written.
      const lead = await updateLead(
        action.leadId,
        userId,
        { status: action.status },
        actor,
      );

      return `صار ${lead.companyName} في حالة ${action.status}.`;
    }

    case 'discovery_scan': {
      const result = await runDiscoveryScan({
        userId,
        actor,
        query: action.query,
        location: action.location,
      });

      return `بحث «${action.query}» في ${action.location}: وُجد ${result.found}، استُورد ${result.imported}.`;
    }

    case 'none':
      return 'no action';
  }
}

/**
 * The actions this agent may take, for the prompt.
 *
 * Given to the model so it proposes from its own role rather than guessing at
 * the whole surface and being refused.
 */
export function permittedActions(agentId: string): AgentActionKind[] {
  return ALLOWED[agentId] ?? [];
}
