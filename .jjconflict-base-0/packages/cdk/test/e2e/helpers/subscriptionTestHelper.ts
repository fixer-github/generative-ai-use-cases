/**
 * Subscription Test Helper for E2E Tests
 *
 * Provides utilities to create and manage subscriptions directly for testing.
 * Creates real Stripe subscriptions in test mode.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import Stripe from 'stripe';
import { testConfig } from '../setup';

/**
 * Input for creating a test subscription
 */
export interface CreateTestSubscriptionInput {
  userId: string;
  planId: string;
  platformType?: 'stripe' | 'apple' | 'google';
  platformSubscriptionId?: string;
  /** Stripe Price ID (required for creating real Stripe subscriptions) */
  stripePriceId?: string;
  /** Duration in days from now for the subscription period */
  periodDurationDays?: number;
  /** Set to true to create an already-expired subscription */
  expired?: boolean;
  /** Set to true to create a subscription ending soon (1 minute) */
  endingSoon?: boolean;
}

/**
 * Output from creating a test subscription
 */
export interface CreateTestSubscriptionOutput {
  subscriptionId: string;
  applicationId: string;
  status: 'active' | 'pending_verification';
  /** The real Stripe subscription ID (if created) */
  platformSubscriptionId?: string;
}

/**
 * Random ID generator
 */
function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Subscription Test Helper
 *
 * Creates subscriptions via internal Lambda functions.
 * For Stripe platform type, creates real Stripe subscriptions in test mode.
 */
export class SubscriptionTestHelper {
  private lambdaClient: LambdaClient;
  private secretsClient: SecretsManagerClient;
  private tenantId: string;
  private environment: string;
  private createdSubscriptionIds: string[] = [];
  private createdStripeSubscriptionIds: string[] = [];
  private stripeClient: Stripe | null = null;

  constructor(tenantId?: string) {
    this.lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.secretsClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.tenantId = tenantId || testConfig.tenantId;
    this.environment = process.env.E2E_ENV_NAME || 'tmp';
  }

  /**
   * Get or initialize Stripe client
   */
  private async getStripeClient(): Promise<Stripe> {
    if (this.stripeClient) {
      return this.stripeClient;
    }

    // Try environment variable first (for local testing)
    const envApiKey = process.env.STRIPE_SECRET_KEY;
    if (envApiKey) {
      this.stripeClient = new Stripe(envApiKey, {
        apiVersion: '2025-10-29.clover',
      });
      return this.stripeClient;
    }

    // Fall back to Secrets Manager
    try {
      const secretName = `${this.tenantId}/billing/stripe`;
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await this.secretsClient.send(command);

      if (!response.SecretString) {
        throw new Error(`Secret ${secretName} is empty`);
      }

      const secret = JSON.parse(response.SecretString);
      this.stripeClient = new Stripe(secret.apiKey, {
        apiVersion: '2025-10-29.clover',
      });
      return this.stripeClient;
    } catch (error) {
      console.warn('Failed to get Stripe API key from Secrets Manager:', error);
      throw new Error(
        'Stripe API key not available. Set STRIPE_SECRET_KEY env var or configure Secrets Manager.'
      );
    }
  }

  /**
   * Create a real Stripe subscription in test mode
   */
  private async createStripeSubscription(
    stripePriceId: string
  ): Promise<{ subscriptionId: string; periodStart: Date; periodEnd: Date }> {
    const stripe = await this.getStripeClient();

    // Create a test customer
    const customer = await stripe.customers.create({
      email: `test-${Date.now()}-${randomId()}@example.com`,
      metadata: {
        test: 'true',
        created_by: 'e2e-test',
      },
    });

    // Attach a test payment method (Stripe test card)
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        token: 'tok_visa', // Stripe test token for Visa card
      },
    });

    await stripe.paymentMethods.attach(paymentMethod.id, {
      customer: customer.id,
    });

    // Set as default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: paymentMethod.id,
      },
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: stripePriceId }],
      metadata: {
        test: 'true',
        created_by: 'e2e-test',
      },
    });

    // Track for cleanup
    this.createdStripeSubscriptionIds.push(subscription.id);

    // Get period from subscription item
    const subscriptionItem = subscription.items.data[0];

    return {
      subscriptionId: subscription.id,
      periodStart: new Date(subscriptionItem.current_period_start * 1000),
      periodEnd: new Date(subscriptionItem.current_period_end * 1000),
    };
  }

  /**
   * Create an active subscription for testing
   *
   * For Stripe platform type with stripePriceId, creates a real Stripe subscription.
   * Otherwise creates a mock subscription in the database.
   */
  async createSubscription(
    input: CreateTestSubscriptionInput
  ): Promise<CreateTestSubscriptionOutput> {
    const {
      userId,
      planId,
      platformType = 'stripe',
      stripePriceId,
      periodDurationDays = 30,
      expired = false,
      endingSoon = false,
    } = input;

    let platformSubscriptionId = input.platformSubscriptionId;
    let periodStart: Date;
    let periodEnd: Date;

    // For Stripe with price ID, create real subscription
    if (platformType === 'stripe' && stripePriceId && !expired && !endingSoon) {
      try {
        console.log('Creating real Stripe subscription in test mode...');
        const stripeResult = await this.createStripeSubscription(stripePriceId);
        platformSubscriptionId = stripeResult.subscriptionId;
        periodStart = stripeResult.periodStart;
        periodEnd = stripeResult.periodEnd;
        console.log(`Real Stripe subscription created: ${platformSubscriptionId}`);
      } catch (error) {
        console.warn('Failed to create real Stripe subscription, using mock:', error);
        // Fall back to mock subscription
        platformSubscriptionId = platformSubscriptionId || `sub_test_${Date.now()}_${randomId()}`;
        const now = new Date();
        periodStart = now;
        periodEnd = new Date(now.getTime() + periodDurationDays * 24 * 60 * 60 * 1000);
      }
    } else {
      // Use mock subscription ID for non-Stripe or special cases
      platformSubscriptionId = platformSubscriptionId || `sub_test_${Date.now()}_${randomId()}`;

      // Calculate period dates
      const now = new Date();

      if (expired) {
        // Create an expired subscription (ended 1 day ago)
        periodEnd = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        periodStart = new Date(
          periodEnd.getTime() - periodDurationDays * 24 * 60 * 60 * 1000
        );
      } else if (endingSoon) {
        // Create a subscription ending in 1 minute
        periodStart = new Date(
          now.getTime() - periodDurationDays * 24 * 60 * 60 * 1000
        );
        periodEnd = new Date(now.getTime() + 60 * 1000); // 1 minute from now
      } else {
        // Create a normal active subscription
        periodStart = now;
        periodEnd = new Date(
          now.getTime() + periodDurationDays * 24 * 60 * 60 * 1000
        );
      }
    }

    const functionName = `${this.environment}-billing-subscription-internal-create`;

    const payload = {
      userId,
      planId,
      platformType,
      platformSubscriptionId,
      subscriptionStatus: 'active',
      currentPeriodStart: periodStart!.toISOString(),
      currentPeriodEnd: periodEnd!.toISOString(),
      tenantId: this.tenantId,
    };

    console.log(`Creating test subscription via Lambda: ${functionName}`, {
      userId,
      planId,
      platformSubscriptionId,
      periodStart: periodStart!.toISOString(),
      periodEnd: periodEnd!.toISOString(),
    });

    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    });

    const response = await this.lambdaClient.send(command);

    if (response.FunctionError) {
      const errorPayload = response.Payload
        ? JSON.parse(new TextDecoder().decode(response.Payload))
        : {};
      throw new Error(
        `Failed to create subscription: ${errorPayload.errorMessage || response.FunctionError}`
      );
    }

    if (!response.Payload) {
      throw new Error('No payload returned from createSubscription Lambda');
    }

    const subscriptionResult = JSON.parse(
      new TextDecoder().decode(response.Payload)
    );

    // Track for cleanup
    this.createdSubscriptionIds.push(subscriptionResult.subscriptionId);

    console.log(`Test subscription created: ${subscriptionResult.subscriptionId}`);

    // Step 2: Create plan_application via applyPlanToUser Lambda
    const applyPlanFunctionName = `${this.environment}-billing-plan-internal-apply`;

    const applyPlanPayload = {
      userId,
      planId,
      applicationSource: 'subscription',
      applicationSourceId: subscriptionResult.subscriptionId,
      validFrom: periodStart!.toISOString(),
      validUntil: expired ? periodEnd!.toISOString() : undefined,
      tenantId: this.tenantId,
    };

    console.log(
      `Creating plan application via Lambda: ${applyPlanFunctionName}`,
      {
        userId,
        planId,
        subscriptionId: subscriptionResult.subscriptionId,
      }
    );

    const applyPlanCommand = new InvokeCommand({
      FunctionName: applyPlanFunctionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(applyPlanPayload)),
    });

    const applyPlanResponse = await this.lambdaClient.send(applyPlanCommand);

    if (applyPlanResponse.FunctionError) {
      const errorPayload = applyPlanResponse.Payload
        ? JSON.parse(new TextDecoder().decode(applyPlanResponse.Payload))
        : {};
      throw new Error(
        `Failed to apply plan to user: ${errorPayload.errorMessage || applyPlanResponse.FunctionError}`
      );
    }

    if (!applyPlanResponse.Payload) {
      throw new Error('No payload returned from applyPlanToUser Lambda');
    }

    const applyPlanResult = JSON.parse(
      new TextDecoder().decode(applyPlanResponse.Payload)
    );

    console.log(`Plan application created: ${applyPlanResult.applicationId}`);

    return {
      subscriptionId: subscriptionResult.subscriptionId,
      applicationId: applyPlanResult.applicationId,
      status: subscriptionResult.status,
      platformSubscriptionId,
    };
  }

  /**
   * Cancel Stripe subscriptions created during tests
   */
  async cleanupStripeSubscriptions(): Promise<void> {
    if (this.createdStripeSubscriptionIds.length === 0) {
      return;
    }

    try {
      const stripe = await this.getStripeClient();

      for (const subId of this.createdStripeSubscriptionIds) {
        try {
          await stripe.subscriptions.cancel(subId);
          console.log(`Cleaned up Stripe subscription: ${subId}`);
        } catch (error) {
          console.warn(`Failed to cleanup Stripe subscription ${subId}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup Stripe subscriptions:', error);
    }

    this.createdStripeSubscriptionIds = [];
  }

  /**
   * Complete a Checkout Session by simulating payment completion.
   *
   * In Stripe test mode, we cannot programmatically complete an embedded checkout session
   * without browser automation. This method creates the equivalent subscription that would
   * result from a completed checkout, allowing E2E testing of the activation flow.
   *
   * @param sessionId - The Stripe Checkout Session ID
   * @returns The created subscription details
   */
  async completeCheckoutSession(sessionId: string): Promise<{
    subscriptionId: string;
    customerId: string;
    status: string;
  }> {
    const stripe = await this.getStripeClient();

    // Retrieve the checkout session to get its configuration
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'line_items.data.price'],
    });

    if (session.status === 'complete') {
      // Session already complete, return existing subscription info
      return {
        subscriptionId: session.subscription as string,
        customerId: session.customer as string,
        status: 'complete',
      };
    }

    // Get the price ID from line items
    const lineItems = session.line_items?.data;
    if (!lineItems || lineItems.length === 0) {
      throw new Error('Checkout session has no line items');
    }

    const priceId = lineItems[0].price?.id;
    if (!priceId) {
      throw new Error('Could not extract price ID from checkout session');
    }

    // Create a customer if one doesn't exist
    let customerId = session.customer as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.customer_email || `test-checkout-${Date.now()}@example.com`,
        metadata: {
          test: 'true',
          created_by: 'e2e-test',
          checkout_session: sessionId,
        },
      });
      customerId = customer.id;
    }

    // Attach a test payment method
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        token: 'tok_visa',
      },
    });

    await stripe.paymentMethods.attach(paymentMethod.id, {
      customer: customerId,
    });

    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethod.id,
      },
    });

    // Create the subscription (this is what Checkout would do after payment)
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      metadata: {
        test: 'true',
        created_by: 'e2e-test',
        checkout_session: sessionId,
      },
    });

    // Track for cleanup
    this.createdStripeSubscriptionIds.push(subscription.id);

    console.log(`Checkout session ${sessionId} simulated completion with subscription: ${subscription.id}`);

    return {
      subscriptionId: subscription.id,
      customerId,
      status: subscription.status,
    };
  }

  /**
   * Get created subscription IDs for tracking
   */
  getCreatedSubscriptionIds(): string[] {
    return [...this.createdSubscriptionIds];
  }

  /**
   * Clear tracking (call after test cleanup)
   */
  clearTracking(): void {
    this.createdSubscriptionIds = [];
  }
}

/**
 * Generate a unique platform subscription ID for tests
 */
export function generateTestPlatformSubscriptionId(): string {
  return `sub_test_${Date.now()}_${randomId()}`;
}
