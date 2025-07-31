import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface TenantDynamoDBStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId: string;

  /**
   * Description for the stack
   * @default 'DynamoDB tables for tenant {tenantId}'
   */
  readonly description?: string;

  /**
   * Billing mode for the tables
   * @default BillingMode.PAY_PER_REQUEST
   */
  readonly billingMode?: dynamodb.BillingMode;

  /**
   * Enable point-in-time recovery
   * @default true
   */
  readonly pointInTimeRecovery?: boolean;

  /**
   * Removal policy for tables
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
}

/**
 * Stack for creating tenant-specific DynamoDB tables
 */
export class TenantDynamoDBStack extends cdk.Stack {
  /**
   * The chat history table for the tenant
   */
  public readonly chatHistoryTable: dynamodb.Table;

  /**
   * The token usage statistics table for the tenant
   */
  public readonly tokenUsageStatsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: TenantDynamoDBStackProps) {
    super(scope, id, props);

    const { tenantId } = props;

    // Validate tenant ID
    if (!tenantId || tenantId.trim() === '') {
      throw new Error('Tenant ID is required');
    }

    // Sanitize tenant ID for use in resource names
    const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9-]/g, '-');

    // Chat History Table
    this.chatHistoryTable = new dynamodb.Table(this, 'ChatHistoryTable', {
      tableName: `ChatHistory-tenant-${sanitizedTenantId}`,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdDate',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: props.billingMode || dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: props.pointInTimeRecovery !== false,
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Add feedback index
    this.chatHistoryTable.addGlobalSecondaryIndex({
      indexName: 'FeedbackIndex',
      partitionKey: {
        name: 'feedback',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Token Usage Stats Table
    this.tokenUsageStatsTable = new dynamodb.Table(this, 'TokenUsageStatsTable', {
      tableName: `TokenUsageStats-tenant-${sanitizedTenantId}`,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: props.billingMode || dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: props.pointInTimeRecovery !== false,
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Add month index for usage stats
    this.tokenUsageStatsTable.addGlobalSecondaryIndex({
      indexName: 'MonthIndex',
      partitionKey: {
        name: 'month',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Output table ARNs
    new cdk.CfnOutput(this, 'ChatHistoryTableArn', {
      value: this.chatHistoryTable.tableArn,
      description: `ARN of the chat history table for tenant ${tenantId}`,
      exportName: `${this.stackName}-ChatHistoryTableArn`,
    });

    new cdk.CfnOutput(this, 'TokenUsageStatsTableArn', {
      value: this.tokenUsageStatsTable.tableArn,
      description: `ARN of the token usage stats table for tenant ${tenantId}`,
      exportName: `${this.stackName}-TokenUsageStatsTableArn`,
    });

    // Output table names
    new cdk.CfnOutput(this, 'ChatHistoryTableName', {
      value: this.chatHistoryTable.tableName,
      description: `Name of the chat history table for tenant ${tenantId}`,
      exportName: `${this.stackName}-ChatHistoryTableName`,
    });

    new cdk.CfnOutput(this, 'TokenUsageStatsTableName', {
      value: this.tokenUsageStatsTable.tableName,
      description: `Name of the token usage stats table for tenant ${tenantId}`,
      exportName: `${this.stackName}-TokenUsageStatsTableName`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', tenantId);
    cdk.Tags.of(this).add('Purpose', 'TenantDynamoDBTables');
  }
}