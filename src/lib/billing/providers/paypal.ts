import crypto from 'node:crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import {
  ProviderCapabilityError,
  type BillingProvider,
  type CreateCheckoutInput,
  type CreateCheckoutResult,
  type ProviderCapabilities,
  type VerifiedWebhook,
} from '../provider';

/**
 * PayPal provider.
 *
 * Two things this deliberately does not do:
 *
 *  - It does not assume the merchant account has the Subscriptions API.
 *    Not every PayPal account does, and pretending otherwise produces an
 *    integration that fails at the worst possible moment. `capabilities()`
 *    probes and reports.
 *
 *  - It does not verify webhooks locally. PayPal's own
 *    `/v1/notifications/verify-webhook-signature` endpoint is the only
 *    supported mechanism; a hand-rolled signature check against their cert
 *    chain is a way to get verification subtly wrong.
 */

const API_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  production: 'https://api-m.paypal.com',
} as const;

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export class PayPalProvider implements BillingProvider {
  readonly name = 'paypal';

  private baseUrl(): string {
    return API_BASE[env().PAYPAL_ENVIRONMENT];
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const config = env();

    if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET) {
      throw new ProviderCapabilityError(
        'restApi',
        'PayPal is not configured: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required.',
      );
    }

    return {
      clientId: config.PAYPAL_CLIENT_ID,
      clientSecret: config.PAYPAL_CLIENT_SECRET,
    };
  }

  /** OAuth token, cached until shortly before it expires. */
  private async accessToken(): Promise<string> {
    if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
      return tokenCache.token;
    }

    const { clientId, clientSecret } = this.credentials();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(`${this.baseUrl()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      // The body can echo the client id; it is not logged.
      throw new ProviderCapabilityError(
        'restApi',
        `PayPal rejected the credentials (HTTP ${response.status}).`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return data.access_token;
  }

  private async request(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {},
  ): Promise<Response> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };

    // PayPal deduplicates on this header, which is what makes a retried
    // checkout return the original order instead of creating a second one.
    if (init.idempotencyKey) headers['PayPal-Request-Id'] = init.idempotencyKey;

    return fetch(`${this.baseUrl()}${path}`, { ...init, headers });
  }

  /**
   * Probes what this merchant account can actually do.
   *
   * Never assumes. A 401 means the credentials are wrong; a 403 on the billing
   * plans endpoint means the account exists but lacks the Subscriptions
   * capability, which is a merchant-account setting rather than a code fault.
   */
  async capabilities(): Promise<ProviderCapabilities> {
    const config = env();
    const detail: string[] = [];

    const result: ProviderCapabilities = {
      restApi: false,
      subscriptions: false,
      webhooks: Boolean(config.PAYPAL_WEBHOOK_ID),
      production: config.PAYPAL_ENVIRONMENT === 'production',
      detail,
    };

    if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET) {
      detail.push('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set.');
      return result;
    }

    try {
      await this.accessToken();
      result.restApi = true;
      detail.push(`REST API reachable (${config.PAYPAL_ENVIRONMENT}).`);
    } catch (error) {
      detail.push(
        `REST API unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return result;
    }

    try {
      const response = await this.request('/v1/billing/plans?page_size=1', {
        method: 'GET',
      });

      if (response.ok) {
        result.subscriptions = true;
        detail.push('Subscriptions API available.');
      } else if (response.status === 403) {
        detail.push(
          'Subscriptions API returned 403 — the merchant account does not have the Subscriptions capability enabled.',
        );
      } else {
        detail.push(`Subscriptions API returned HTTP ${response.status}.`);
      }
    } catch (error) {
      detail.push(
        `Subscriptions probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    if (!result.webhooks) {
      detail.push('PAYPAL_WEBHOOK_ID not set — webhooks cannot be verified.');
    }

    return result;
  }

  /**
   * Creates a PayPal order for the resolved amount.
   *
   * Amount and currency come from `input`, which the caller resolved from the
   * trusted catalog. Nothing here reads a client-supplied price.
   */
  async createCheckout(
    input: CreateCheckoutInput,
  ): Promise<CreateCheckoutResult> {
    const response = await this.request('/v2/checkout/orders', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: input.planCode,
            custom_id: input.userId,
            description: `Tasami ${input.planCode} (${input.interval.toLowerCase()})`,
            amount: {
              currency_code: input.currency,
              value: (input.amount / 100).toFixed(2),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              user_action: 'PAY_NOW',
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      logger.error('PayPal order creation failed', { status });
      throw new ProviderCapabilityError(
        'restApi',
        `PayPal could not create the checkout (HTTP ${status}).`,
      );
    }

    const data = (await response.json()) as {
      id: string;
      links?: Array<{ rel: string; href: string }>;
    };

    const approval = data.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');

    if (!approval) {
      throw new ProviderCapabilityError(
        'restApi',
        'PayPal returned no approval link for the order.',
      );
    }

    return { providerOrderId: data.id, approvalUrl: approval.href };
  }

  /**
   * Verifies a webhook through PayPal's verification endpoint.
   *
   * Fails closed: any missing header, missing webhook id, non-200 response or
   * verification status other than SUCCESS returns `verified: false`.
   */
  async verifyWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<VerifiedWebhook> {
    const webhookId = env().PAYPAL_WEBHOOK_ID;

    const unverified: VerifiedWebhook = {
      verified: false,
      eventId: null,
      eventType: null,
      providerSubscriptionId: null,
      metadata: {},
    };

    if (!webhookId) {
      logger.error('PayPal webhook rejected: PAYPAL_WEBHOOK_ID not configured');
      return unverified;
    }

    const required = [
      'paypal-transmission-id',
      'paypal-transmission-time',
      'paypal-transmission-sig',
      'paypal-cert-url',
      'paypal-auth-algo',
    ];

    const lower = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );

    if (required.some((h) => !lower[h])) {
      logger.warn('PayPal webhook rejected: missing signature headers');
      return unverified;
    }

    let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };

    try {
      event = JSON.parse(rawBody);
    } catch {
      logger.warn('PayPal webhook rejected: body is not valid JSON');
      return unverified;
    }

    try {
      const response = await this.request(
        '/v1/notifications/verify-webhook-signature',
        {
          method: 'POST',
          body: JSON.stringify({
            transmission_id: lower['paypal-transmission-id'],
            transmission_time: lower['paypal-transmission-time'],
            cert_url: lower['paypal-cert-url'],
            auth_algo: lower['paypal-auth-algo'],
            transmission_sig: lower['paypal-transmission-sig'],
            webhook_id: webhookId,
            webhook_event: event,
          }),
        },
      );

      if (!response.ok) {
        logger.warn('PayPal webhook verification call failed', {
          status: response.status,
        });
        return unverified;
      }

      const body = (await response.json()) as { verification_status?: string };

      if (body.verification_status !== 'SUCCESS') {
        logger.warn('PayPal webhook signature verification failed');
        return unverified;
      }
    } catch (error) {
      logger.error('PayPal webhook verification error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return unverified;
    }

    const resource = (event.resource ?? {}) as Record<string, unknown>;

    return {
      verified: true,
      eventId: event.id ?? null,
      eventType: event.event_type ?? null,
      providerSubscriptionId:
        typeof resource.id === 'string' ? resource.id : null,
      // Only identifiers and state — no payer contact details, no payment
      // instrument data.
      metadata: {
        resourceId: resource.id,
        status: resource.status,
        customId: resource.custom_id,
        planId: resource.plan_id,
      },
    };
  }

  async cancelSubscription(
    providerSubscriptionId: string,
    reason: string,
  ): Promise<void> {
    const response = await this.request(
      `/v1/billing/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );

    if (!response.ok && response.status !== 204) {
      throw new ProviderCapabilityError(
        'subscriptions',
        `PayPal could not cancel the subscription (HTTP ${response.status}).`,
      );
    }
  }
}

/** SHA-256 of a raw webhook body, for correlating a delivery without storing it. */
export function hashPayload(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}
