/**
 * Webhook Test Client for E2E Tests
 *
 * Provides HTTP client for making webhook requests without authentication headers.
 * Supports Stripe signature generation for webhook testing.
 */

import { createHmac } from 'crypto';
import { testConfig } from '../setup';

export interface WebhookResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

export interface StripeSignatureOptions {
  timestamp?: number;
  secret: string;
}

/**
 * Webhook Test Client for making unauthenticated HTTP requests to webhook endpoints
 */
export class WebhookTestClient {
  private baseUrl: string;
  private tenantId: string;

  constructor(baseUrl: string, tenantId: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.tenantId = tenantId;
  }

  /**
   * Create a webhook test client with the configured base URL
   */
  static create(tenantId?: string): WebhookTestClient {
    const baseUrl = process.env.E2E_API_BASE_URL || testConfig.apiBaseUrl;
    const tenant = tenantId || testConfig.tenantId;

    if (!baseUrl) {
      throw new Error('API base URL is not configured.');
    }
    if (!tenant) {
      throw new Error('Tenant ID is not configured.');
    }

    return new WebhookTestClient(baseUrl, tenant);
  }

  /**
   * Generate a valid Stripe webhook signature
   *
   * @param payload - The raw JSON payload string
   * @param options - Signature options including secret and optional timestamp
   * @returns Stripe-Signature header value in format: t={timestamp},v1={signature}
   */
  static generateStripeSignature(
    payload: string,
    options: StripeSignatureOptions
  ): string {
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;
    const signature = createHmac('sha256', options.secret)
      .update(signedPayload)
      .digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  /**
   * Send a Stripe webhook with valid signature
   */
  async sendStripeWebhook(
    payload: Record<string, unknown>,
    secret: string
  ): Promise<WebhookResponse> {
    const rawPayload = JSON.stringify(payload);
    const signature = WebhookTestClient.generateStripeSignature(rawPayload, {
      secret,
    });
    return this.sendWebhook(
      `/billing/webhook/${this.tenantId}/stripe`,
      rawPayload,
      {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature,
      }
    );
  }

  /**
   * Send a Stripe webhook without signature (for 400 error testing)
   */
  async sendStripeWebhookWithoutSignature(
    payload: Record<string, unknown>
  ): Promise<WebhookResponse> {
    return this.sendWebhook(
      `/billing/webhook/${this.tenantId}/stripe`,
      JSON.stringify(payload),
      {
        'Content-Type': 'application/json',
      }
    );
  }

  /**
   * Send a Stripe webhook with invalid signature (for 401 error testing)
   */
  async sendStripeWebhookWithInvalidSignature(
    payload: Record<string, unknown>
  ): Promise<WebhookResponse> {
    return this.sendWebhook(
      `/billing/webhook/${this.tenantId}/stripe`,
      JSON.stringify(payload),
      {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1234567890,v1=invalid_signature_for_testing',
      }
    );
  }

  /**
   * Low-level method to send webhook with custom headers
   */
  async sendWebhook(
    path: string,
    payload: string,
    headers: Record<string, string> = {}
  ): Promise<WebhookResponse> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let data: unknown;
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      status: response.status,
      data,
      headers: responseHeaders,
    };
  }
}
