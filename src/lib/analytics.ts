import { logger } from '@/lib/logger';

/**
 * Product analytics.
 *
 * Events are emitted as structured log lines rather than posted to a vendor:
 * no analytics provider is configured yet, and inventing an integration for a
 * service that has not been chosen would be worse than none. Every event is
 * already captured in a parseable form, so wiring a destination later is a
 * change to `deliver` alone.
 *
 * Event names are fixed so a dashboard can be built against them without
 * chasing renames.
 */
export type AnalyticsEvent =
  | 'signup'
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'company_discovered'
  | 'opportunity_created'
  | 'lead_created'
  | 'outreach_generated'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'outreach_sent'
  | 'response_received'
  | 'qualified_lead'
  | 'requirement_created';

export interface AnalyticsContext {
  /** Hashed or opaque id only — never an email address. */
  userId?: string;
  agentId?: string;
  approvalId?: string;
  [key: string]: unknown;
}

function deliver(event: AnalyticsEvent, context: AnalyticsContext): void {
  // `logger` redacts anything credential-shaped before it is written.
  logger.info(`analytics.${event}`, { event, ...context });
}

export function track(event: AnalyticsEvent, context: AnalyticsContext = {}): void {
  try {
    deliver(event, context);
  } catch (error) {
    // Analytics must never break a request.
    logger.warn('Failed to record analytics event', {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
