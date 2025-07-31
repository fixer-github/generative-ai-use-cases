import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { TenantDynamoDB } from '../../construct/tenant-dynamodb';

export interface TenantDynamoDBStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId?: string;

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
   * The tenant DynamoDB construct
   */
  public readonly tenantDynamoDB: TenantDynamoDB;

  /**
   * The chat history table for the tenant
   */
  public get chatHistoryTable(): dynamodb.Table {
    return this.tenantDynamoDB.chatHistoryTable;
  }

  /**
   * The token usage statistics table for the tenant
   */
  public get tokenUsageStatsTable(): dynamodb.Table {
    return this.tenantDynamoDB.tokenUsageStatsTable;
  }

  constructor(scope: Construct, id: string, props?: TenantDynamoDBStackProps) {
    super(scope, id, props);

    // Create parameter if tenant ID not provided
    const tenantId = props?.tenantId || new cdk.CfnParameter(this, 'TenantId', {
      description: 'The tenant identifier for the DynamoDB tables',
      type: 'String',
      allowedPattern: '^[a-zA-Z0-9-]+$',
      constraintDescription: 'Tenant ID must contain only alphanumeric characters and hyphens',
    }).valueAsString;

    // Create the tenant DynamoDB construct
    this.tenantDynamoDB = new TenantDynamoDB(this, 'TenantDynamoDB', {
      tenantId,
      chatHistoryTableBaseName: props?.chatHistoryTableBaseName,
      tokenUsageStatsTableBaseName: props?.tokenUsageStatsTableBaseName,
      billingMode: props?.billingMode,
      pointInTimeRecovery: props?.pointInTimeRecovery,
      removalPolicy: props?.removalPolicy,
    });

    // Add stack-level outputs with export names
    new cdk.CfnOutput(this, 'StackChatHistoryTableArn', {
      value: this.tenantDynamoDB.chatHistoryTable.tableArn,
      description: `ARN of the chat history table for tenant ${tenantId}`,
      exportName: `${this.stackName}-ChatHistoryTableArn`,
    });

    new cdk.CfnOutput(this, 'StackTokenUsageStatsTableArn', {
      value: this.tenantDynamoDB.tokenUsageStatsTable.tableArn,
      description: `ARN of the token usage stats table for tenant ${tenantId}`,
      exportName: `${this.stackName}-TokenUsageStatsTableArn`,
    });

    new cdk.CfnOutput(this, 'StackChatHistoryTableName', {
      value: this.tenantDynamoDB.chatHistoryTable.tableName,
      description: `Name of the chat history table for tenant ${tenantId}`,
      exportName: `${this.stackName}-ChatHistoryTableName`,
    });

    new cdk.CfnOutput(this, 'StackTokenUsageStatsTableName', {
      value: this.tenantDynamoDB.tokenUsageStatsTable.tableName,
      description: `Name of the token usage stats table for tenant ${tenantId}`,
      exportName: `${this.stackName}-TokenUsageStatsTableName`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', tenantId.toString());
    cdk.Tags.of(this).add('Purpose', 'TenantDynamoDBTables');

    // Set stack description
    this.templateOptions.description = props?.description || 
      'Creates tenant-specific DynamoDB tables for multi-tenant application';
  }
}