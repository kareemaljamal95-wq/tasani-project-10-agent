/**
 * Payment provider boundary.
 *
 * The billing domain speaks this interface and nothing else. No PayPal type
 * appears in a route, a service or the schema — the domain stores a provider
 * name plus opaque provider identifiers, which is what makes a second provider
 * an added file rather than a rewrite.
 */

export interface ProviderCapabilities {
  /** REST credentials present and an access token obtainable. */
  restApi: boolean;
  /** Subscriptions/billing-plans API usable by this merchant account. */
  subscriptions: boolean;
  /** Webhook verification configured (webhook id present). */
  webhooks: boolean;
  /** Running against production rather than sandbox. */
  production: boolean;
  /** Human-readable detail for the operator, safe to log. */
  detail: string[];
}

export interface CreateCheckoutInput {
  userId: string;
  /** Resolved server-side from the catalog — never supplied by the client. */
  planCode: string;
  interval: 'MONTH' | 'YEAR';
  currency: string;
  amount: number;
  offerCode?: string;
  returnUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface CreateCheckoutResult {
  providerOrderId: string;
  approvalUrl: string;
  expiresAt?: Date;
}

export interface VerifiedWebhook {
  verified: boolean;
  eventId: string | null;
  eventType: string | null;
  /** Provider subscription id, when the event carries one. */
  providerSubscriptionId: string | null;
  /** Safe, redacted subset of the payload for the audit record. */
  metadata: Record<string, unknown>;
}

export interface BillingProvider {
  readonly name: string;

  /** Reports what this deployment can actually do. Never guesses. */
  capabilities(): Promise<ProviderCapabilities>;

  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;

  /** Verifies a webhook's authenticity using the provider's own mechanism. */
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<VerifiedWebhook>;

  /**
   * Takes the money for an order the buyer has approved.
   *
   * Separate from `createCheckout` because approval and capture are two
   * distinct events at the provider: a buyer pressing "Pay Now" leaves the
   * order APPROVED, and nothing moves until this is called. Optional on the
   * interface — a provider whose checkout settles on approval has nothing to
   * do here.
   */
  captureOrder?(providerOrderId: string): Promise<void>;

  /**
   * Reads an order's current state straight from the provider.
   *
   * The provider is the source of truth for whether money moved, and this asks
   * it directly rather than waiting to be told. It is what lets a payment be
   * reconciled when a webhook is delayed, misrouted or never configured.
   */
  getOrder?(providerOrderId: string): Promise<{ status: string } | null>;

  cancelSubscription(providerSubscriptionId: string, reason: string): Promise<void>;
}

/**
 * Thrown when the provider refused the money itself.
 *
 * Distinct from `ProviderCapabilityError` because the two need opposite
 * answers: a capability failure means *we* could not ask, and the customer
 * should wait and retry; a decline means the provider answered clearly and the
 * customer must change payment method. Reporting a decline as "could not
 * confirm the payment" sends someone to retry a card that will refuse again.
 */
export class PaymentDeclinedError extends Error {
  constructor(
    message: string,
    /** The provider's own issue code, when it named one. */
    readonly issue?: string,
  ) {
    super(message);
    this.name = 'PaymentDeclinedError';
  }
}

/** Thrown when an operation needs a provider capability this account lacks. */
export class ProviderCapabilityError extends Error {
  constructor(
    readonly capability: keyof ProviderCapabilities,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderCapabilityError';
  }
}
