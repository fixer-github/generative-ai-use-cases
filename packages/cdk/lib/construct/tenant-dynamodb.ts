import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface TenantDynamoDBProps {
  /**
   * The tenant identifier
   */
  readonly tenantId: string;

  /**
   * Base name for the chat history table
   * @default 'ChatHistory'
   */
  readonly chatHistoryTableBaseName?: string;

  /**
   * Base name for the token usage stats table
   * @default 'TokenUsageStats'
   */
  readonly tokenUsageStatsTableBaseName?: string;

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

  /**
   * Table encryption
   * @default TableEncryption.AWS_MANAGED
   */
  readonly encryption?: dynamodb.TableEncryption;
}

export class TenantDynamoDB extends Construct {
  /**
   * The chat history table for the tenant
   */
  public readonly chatHistoryTable: dynamodb.Table;

  /**
   * The token usage statistics table for the tenant
   */
  public readonly tokenUsageStatsTable: dynamodb.Table;

  /**
   * The tenant ID
   */
  public readonly tenantId: string;

  /**
   * Chat history table name
   */
  public readonly chatHistoryTableName: string;

  /**
   * Token usage stats table name
   */
  public readonly tokenUsageStatsTableName: string;

  constructor(scope: Construct, id: string, props: TenantDynamoDBProps) {
    super(scope, id);

    this.tenantId = props.tenantId;

    // Validate tenant ID
    if (!this.tenantId || this.tenantId.trim() === '') {
      throw new Error('Tenant ID is required');
    }

    // Sanitize tenant ID for use in resource names
    const sanitizedTenantId = this.tenantId.replace(/[^a-zA-Z0-9-]/g, '-');

    // Set table names
    const chatHistoryBaseName = props.chatHistoryTableBaseName || 'ChatHistory';
    const tokenUsageStatsBaseName = props.tokenUsageStatsTableBaseName || 'TokenUsageStats';

    this.chatHistoryTableName = `${chatHistoryBaseName}-tenant-${sanitizedTenantId}`;
    this.tokenUsageStatsTableName = `${tokenUsageStatsBaseName}-tenant-${sanitizedTenantId}`;

    // Chat History Table
    this.chatHistoryTable = new dynamodb.Table(this, 'ChatHistoryTable', {
      tableName: this.chatHistoryTableName,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdDate',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: props.billingMode || dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: props.pointInTimeRecovery !== false,
      },
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      encryption: props.encryption || dynamodb.TableEncryption.AWS_MANAGED,
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
      tableName: this.tokenUsageStatsTableName,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: props.billingMode || dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: props.pointInTimeRecovery !== false,
      },
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      encryption: props.encryption || dynamodb.TableEncryption.AWS_MANAGED,
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
      description: `ARN of the chat history table for tenant ${this.tenantId}`,
    });

    new cdk.CfnOutput(this, 'TokenUsageStatsTableArn', {
      value: this.tokenUsageStatsTable.tableArn,
      description: `ARN of the token usage stats table for tenant ${this.tenantId}`,
    });

    // Output table names
    new cdk.CfnOutput(this, 'ChatHistoryTableName', {
      value: this.chatHistoryTable.tableName,
      description: `Name of the chat history table for tenant ${this.tenantId}`,
    });

    new cdk.CfnOutput(this, 'TokenUsageStatsTableName', {
      value: this.tokenUsageStatsTable.tableName,
      description: `Name of the token usage stats table for tenant ${this.tenantId}`,
    });
  }

  /**
   * Generate tenant-specific table name
   * This helper method can be used to generate table names consistently
   */
  public static generateTableName(baseTableName: string, tenantId: string): string {
    const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
    return `${baseTableName}-tenant-${sanitizedTenantId}`;
  }

  /**
   * Create a tenant-specific table with common settings
   * This can be used to create additional tables with the same pattern
   */
  public createTenantTable(
    id: string,
    baseTableName: string,
    partitionKey: dynamodb.Attribute,
    sortKey?: dynamodb.Attribute,
    globalSecondaryIndexes?: dynamodb.GlobalSecondaryIndexProps[]
  ): dynamodb.Table {
    const tableName = TenantDynamoDB.generateTableName(baseTableName, this.tenantId);

    const table = new dynamodb.Table(this, id, {
      tableName,
      partitionKey,
      sortKey,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    if (globalSecondaryIndexes) {
      globalSecondaryIndexes.forEach((gsi) => {
        table.addGlobalSecondaryIndex(gsi);
      });
    }

    return table;
  }
}