import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TenantPaymentGatewayDatabase } from '../../construct/tenant-payment-gateway-database';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';

export interface TenantPaymentGatewayStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId?: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * EventBridge event bus name for webhook event distribution
   * @default 'default'
   */
  readonly eventBusName?: string;

  /**
   * Create Stripe secrets
   * @default false
   */
  readonly createStripeSecrets?: boolean;

  /**
   * Create Apple secrets
   * @default false
   */
  readonly createAppleSecrets?: boolean;

  /**
   * Create Google secrets
   * @default false
   */
  readonly createGoogleSecrets?: boolean;

  /**
   * Description for the stack
   * @default 'Payment Gateway resources for tenant {tenantId}'
   */
  readonly description?: string;

  /**
   * Removal policy for tables
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
}

/**
 * Stack for creating tenant-specific payment gateway resources
 */
export class TenantPaymentGatewayStack extends cdk.Stack {
  /**
   * The tenant payment gateway database construct
   */
  public readonly paymentGatewayDatabase: TenantPaymentGatewayDatabase;

  /**
   * Stripe webhook secret
   */
  public readonly stripeWebhookSecret?: secretsmanager.ISecret;

  /**
   * Apple secrets
   */
  public readonly appleSecret?: secretsmanager.ISecret;

  /**
   * Google secrets
   */
  public readonly googleSecret?: secretsmanager.ISecret;

  /**
   * EventBridge event bus
   */
  public readonly eventBus: events.IEventBus;

  constructor(
    scope: Construct,
    id: string,
    props?: TenantPaymentGatewayStackProps
  ) {
    super(scope, id, props);

    // Create parameter if tenant ID not provided
    const tenantId =
      props?.tenantId ||
      new cdk.CfnParameter(this, 'TenantId', {
        description:
          'The tenant identifier for the payment gateway resources',
        type: 'String',
        allowedPattern: '^[a-zA-Z0-9-]+$',
        constraintDescription:
          'Tenant ID must contain only alphanumeric characters and hyphens',
      }).valueAsString;

    // Get environment (required parameter)
    const environment = props?.environment!;

    // Create the tenant payment gateway database construct
    this.paymentGatewayDatabase = new TenantPaymentGatewayDatabase(
      this,
      'PaymentGatewayDatabase',
      {
        tenantId,
        removalPolicy: props?.removalPolicy,
      }
    );

    // EventBridge event bus
    const eventBusName = props?.eventBusName || 'default';
    this.eventBus =
      eventBusName === 'default'
        ? events.EventBus.fromEventBusName(this, 'EventBus', 'default')
        : new events.EventBus(this, 'TenantEventBus', {
            eventBusName: `${tenantId}-payment-gateway-events`,
          });

    // Create Secrets Manager secrets for payment platforms
    // Note: The actual secret values should be set manually after stack creation
    // or via AWS CLI/Console for security reasons

    if (props?.createStripeSecrets) {
      this.stripeWebhookSecret = new secretsmanager.Secret(
        this,
        'StripeSecret',
        {
          secretName: `${tenantId}/billing/stripe`,
          description: `Stripe Billing credentials for tenant ${tenantId}`,
          generateSecretString: {
            secretStringTemplate: JSON.stringify({
              apiKey: 'REPLACE_WITH_ACTUAL_STRIPE_API_KEY',
              webhookSecret: 'REPLACE_WITH_ACTUAL_WEBHOOK_SECRET',
            }),
            generateStringKey: 'placeholder',
          },
        }
      );
    }

    if (props?.createAppleSecrets) {
      this.appleSecret = new secretsmanager.Secret(this, 'AppleSecret', {
        secretName: `${tenantId}/billing/apple`,
        description: `Apple App Store credentials for tenant ${tenantId}`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            bundleId: 'REPLACE_WITH_ACTUAL_BUNDLE_ID',
            sharedSecret: 'REPLACE_WITH_ACTUAL_SHARED_SECRET',
            isProduction: false,
          }),
          generateStringKey: 'placeholder',
        },
      });
    }

    if (props?.createGoogleSecrets) {
      this.googleSecret = new secretsmanager.Secret(this, 'GoogleSecret', {
        secretName: `${tenantId}/billing/google`,
        description: `Google Play Store credentials for tenant ${tenantId}`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            packageName: 'REPLACE_WITH_ACTUAL_PACKAGE_NAME',
            serviceAccountKey: 'REPLACE_WITH_ACTUAL_SERVICE_ACCOUNT_KEY_JSON',
          }),
          generateStringKey: 'placeholder',
        },
      });
    }

    // Add stack-level outputs with export names

    // Webhook Event Table outputs
    new cdk.CfnOutput(this, 'WebhookEventTableArn', {
      value: this.paymentGatewayDatabase.webhookEventTable.tableArn,
      description: `ARN of the webhook event table for tenant ${tenantId}`,
      exportName: `${this.stackName}-WebhookEventTableArn`,
    });

    new cdk.CfnOutput(this, 'WebhookEventTableName', {
      value: this.paymentGatewayDatabase.webhookEventTable.tableName,
      description: `Name of the webhook event table for tenant ${tenantId}`,
      exportName: `${this.stackName}-WebhookEventTableName`,
    });

    // Receipt Cache Table outputs
    new cdk.CfnOutput(this, 'ReceiptCacheTableArn', {
      value: this.paymentGatewayDatabase.receiptCacheTable.tableArn,
      description: `ARN of the receipt cache table for tenant ${tenantId}`,
      exportName: `${this.stackName}-ReceiptCacheTableArn`,
    });

    new cdk.CfnOutput(this, 'ReceiptCacheTableName', {
      value: this.paymentGatewayDatabase.receiptCacheTable.tableName,
      description: `Name of the receipt cache table for tenant ${tenantId}`,
      exportName: `${this.stackName}-ReceiptCacheTableName`,
    });

    // EventBus outputs
    if (eventBusName !== 'default') {
      new cdk.CfnOutput(this, 'EventBusArn', {
        value: this.eventBus.eventBusArn,
        description: `ARN of the event bus for tenant ${tenantId}`,
        exportName: `${this.stackName}-EventBusArn`,
      });

      new cdk.CfnOutput(this, 'EventBusName', {
        value: this.eventBus.eventBusName,
        description: `Name of the event bus for tenant ${tenantId}`,
        exportName: `${this.stackName}-EventBusName`,
      });
    }

    // Secrets outputs (ARN only, never output actual secret values)
    if (this.stripeWebhookSecret) {
      new cdk.CfnOutput(this, 'StripeSecretArn', {
        value: this.stripeWebhookSecret.secretArn,
        description: `ARN of the Stripe secret for tenant ${tenantId}`,
        exportName: `${this.stackName}-StripeSecretArn`,
      });
    }

    if (this.appleSecret) {
      new cdk.CfnOutput(this, 'AppleSecretArn', {
        value: this.appleSecret.secretArn,
        description: `ARN of the Apple secret for tenant ${tenantId}`,
        exportName: `${this.stackName}-AppleSecretArn`,
      });
    }

    if (this.googleSecret) {
      new cdk.CfnOutput(this, 'GoogleSecretArn', {
        value: this.googleSecret.secretArn,
        description: `ARN of the Google secret for tenant ${tenantId}`,
        exportName: `${this.stackName}-GoogleSecretArn`,
      });
    }

    // Tags
    cdk.Tags.of(this).add('TenantId', tenantId);
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Service', 'PaymentGateway');
  }
}
