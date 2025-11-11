import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface TenantPaymentGatewayDatabaseProps {
  tenantId: string;
  removalPolicy?: RemovalPolicy;
}

/**
 * テナント専用の決済システム連携用DynamoDBテーブルを定義するConstruct
 */
export class TenantPaymentGatewayDatabase extends Construct {
  public readonly webhookEventTable: dynamodb.Table;
  public readonly receiptCacheTable: dynamodb.Table;

  constructor(
    scope: Construct,
    id: string,
    props: TenantPaymentGatewayDatabaseProps
  ) {
    super(scope, id);

    const { tenantId, removalPolicy = RemovalPolicy.RETAIN } = props;

    // Webhookイベントログテーブル
    this.webhookEventTable = new dynamodb.Table(this, 'WebhookEventTable', {
      tableName: `${tenantId}-payment-gateway-webhook-events`,
      partitionKey: {
        name: 'event_id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'received_at',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy,
      pointInTimeRecovery: true,
    });

    // プラットフォーム別の検索用GSI
    this.webhookEventTable.addGlobalSecondaryIndex({
      indexName: 'PlatformTypeIndex',
      partitionKey: {
        name: 'platform_type',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'received_at',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // レシート検証キャッシュテーブル
    this.receiptCacheTable = new dynamodb.Table(this, 'ReceiptCacheTable', {
      tableName: `${tenantId}-payment-gateway-receipt-cache`,
      partitionKey: {
        name: 'receipt_hash',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy,
    });
  }
}
