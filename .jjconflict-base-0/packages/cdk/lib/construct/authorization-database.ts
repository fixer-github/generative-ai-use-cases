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
   * The usage event table
   */
  public readonly usageEventTable: dynamodb.Table;

  /**
   * The permission grant table
   */
  public readonly permissionGrantTable: dynamodb.Table;

  /**
   * Usage event table name
   */
  public readonly usageEventTableName: string;

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
    this.usageEventTableName = `AuthUsageEvent-${environment}-tenant-${sanitizedTenantId}`;
    this.permissionGrantTableName = `AuthPermissionGrant-${environment}-tenant-${sanitizedTenantId}`;

    // ========================================
    // 1. DynamoDB Tables
    // ========================================

    // Usage Event Table
    this.usageEventTable = new dynamodb.Table(this, 'UsageEventTable', {
      tableName: this.usageEventTableName,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      timeToLiveAttribute: 'ttl', // 120日後に自動削除
    });

    // Add tags
    cdk.Tags.of(this.usageEventTable).add('TenantId', props.tenantId);
    cdk.Tags.of(this.usageEventTable).add('Environment', environment);

    // Add GSI for featureId and timestamp (optional - for feature-based queries)
    this.usageEventTable.addGlobalSecondaryIndex({
      indexName: 'featureId-timestamp-index',
      partitionKey: {
        name: 'featureId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
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

    new cdk.CfnOutput(this, 'UsageEventTableName', {
      value: this.usageEventTable.tableName,
      description: 'Usage event table name',
    });

    new cdk.CfnOutput(this, 'PermissionGrantTableName', {
      value: this.permissionGrantTable.tableName,
      description: 'Permission grant table name',
    });
  }
}
