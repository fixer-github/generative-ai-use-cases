/**
 * Authorization Database Construct
 * 権限判定システムのDynamoDBテーブル定義
 *
 * テナント専用スタックで使用されるDynamoDBテーブルのみを作成します
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface AuthorizationDatabaseProps {
  /**
   * The tenant identifier
   */
  readonly tenantId: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Removal policy for stateful resources
   * @default RemovalPolicy.RETAIN for production, DESTROY for dev
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
}

export class AuthorizationDatabase extends Construct {
  /**
   * The usage counter table
   */
  public readonly usageCounterTable: dynamodb.Table;

  /**
   * The permission grant table
   */
  public readonly permissionGrantTable: dynamodb.Table;

  /**
   * Usage counter table name
   */
  public readonly usageCounterTableName: string;

  /**
   * Permission grant table name
   */
  public readonly permissionGrantTableName: string;

  constructor(scope: Construct, id: string, props: AuthorizationDatabaseProps) {
    super(scope, id);

    // Validate props
    if (!props.tenantId || props.tenantId.trim() === '') {
      throw new Error('Tenant ID is required');
    }

    const environment = props.environment || 'dev';
    const sanitizedTenantId = props.tenantId.replace(/[^a-zA-Z0-9-]/g, '-');

    // Determine removal policy
    const removalPolicy =
      props.removalPolicy ||
      (environment === 'dev'
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN);

    // Set table names
    this.usageCounterTableName = `AuthUsageCounter-${environment}-tenant-${sanitizedTenantId}`;
    this.permissionGrantTableName = `AuthPermissionGrant-${environment}-tenant-${sanitizedTenantId}`;

    // ========================================
    // 1. DynamoDB Tables
    // ========================================

    // Usage Counter Table
    this.usageCounterTable = new dynamodb.Table(this, 'UsageCounterTable', {
      tableName: this.usageCounterTableName,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'featureIdPeriod',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
    });

    // Add tags
    cdk.Tags.of(this.usageCounterTable).add('TenantId', props.tenantId);
    cdk.Tags.of(this.usageCounterTable).add('Environment', environment);

    // Add GSI for grantId
    this.usageCounterTable.addGlobalSecondaryIndex({
      indexName: 'grantId-index',
      partitionKey: {
        name: 'grantId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for periodType and nextResetTime
    this.usageCounterTable.addGlobalSecondaryIndex({
      indexName: 'periodType-nextResetTime-index',
      partitionKey: {
        name: 'periodType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'nextResetTime',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Permission Grant Table
    this.permissionGrantTable = new dynamodb.Table(
      this,
      'PermissionGrantTable',
      {
        tableName: this.permissionGrantTableName,
        partitionKey: {
          name: 'grantId',
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: removalPolicy,
      }
    );

    // Add tags
    cdk.Tags.of(this.permissionGrantTable).add('TenantId', props.tenantId);
    cdk.Tags.of(this.permissionGrantTable).add('Environment', environment);

    // Add GSI for userId and status
    this.permissionGrantTable.addGlobalSecondaryIndex({
      indexName: 'userId-status-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // 2. Outputs
    // ========================================

    new cdk.CfnOutput(this, 'UsageCounterTableName', {
      value: this.usageCounterTable.tableName,
      description: 'Usage counter table name',
    });

    new cdk.CfnOutput(this, 'PermissionGrantTableName', {
      value: this.permissionGrantTable.tableName,
      description: 'Permission grant table name',
    });
  }
}
