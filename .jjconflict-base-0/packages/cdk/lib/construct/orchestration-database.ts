/**
 * Orchestration Database Construct
 * オーケストレーション責務のDynamoDBテーブル定義
 *
 * テナント専用スタックで使用されるDynamoDBテーブルを作成します:
 * - 冪等性テーブル（orchestration-idempotency）
 * - フロー実行履歴テーブル（flow-execution-history）
 * - フローステップ実行履歴テーブル（flow-step-execution-history）
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface OrchestrationDatabaseProps {
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

export class OrchestrationDatabase extends Construct {
  /**
   * The idempotency table for purchase flow
   */
  public readonly idempotencyTable: dynamodb.Table;

  /**
   * The flow execution history table
   */
  public readonly flowExecutionHistoryTable: dynamodb.Table;

  /**
   * The flow step execution history table
   */
  public readonly flowStepExecutionHistoryTable: dynamodb.Table;

  /**
   * Idempotency table name
   */
  public readonly idempotencyTableName: string;

  /**
   * Flow execution history table name
   */
  public readonly flowExecutionHistoryTableName: string;

  /**
   * Flow step execution history table name
   */
  public readonly flowStepExecutionHistoryTableName: string;

  constructor(scope: Construct, id: string, props: OrchestrationDatabaseProps) {
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
    // テーブル名はLambda側のflowExecutionRepository.tsと整合させる
    this.idempotencyTableName = `${sanitizedTenantId}-orchestration-idempotency`;
    this.flowExecutionHistoryTableName = `${sanitizedTenantId}-flow-execution-history`;
    this.flowStepExecutionHistoryTableName = `${sanitizedTenantId}-flow-step-execution-history`;

    // ========================================
    // 1. Idempotency Table
    // ========================================
    // 冪等性テーブル: 購入フローの重複実行を防止
    // - sessionId（Stripeの場合）をキーとして処理済みを記録
    // - 成功・失敗に関わらず結果を記録し、同一sessionIdでは同じ結果を返す
    this.idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      tableName: this.idempotencyTableName,
      partitionKey: {
        name: 'idempotencyKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      timeToLiveAttribute: 'ttl',
    });

    // Add tags
    cdk.Tags.of(this.idempotencyTable).add('TenantId', props.tenantId);
    cdk.Tags.of(this.idempotencyTable).add('Environment', environment);
    cdk.Tags.of(this.idempotencyTable).add('Purpose', 'idempotency');

    // ========================================
    // 2. Flow Execution History Table
    // ========================================
    // フロー実行履歴テーブル: オーケストレーションフローの実行履歴を記録
    this.flowExecutionHistoryTable = new dynamodb.Table(
      this,
      'FlowExecutionHistoryTable',
      {
        tableName: this.flowExecutionHistoryTableName,
        partitionKey: {
          name: 'flowExecutionId',
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: removalPolicy,
        timeToLiveAttribute: 'ttl',
      }
    );

    // Add tags
    cdk.Tags.of(this.flowExecutionHistoryTable).add('TenantId', props.tenantId);
    cdk.Tags.of(this.flowExecutionHistoryTable).add('Environment', environment);
    cdk.Tags.of(this.flowExecutionHistoryTable).add('Purpose', 'flow-history');

    // Add GSI for userId-startedAt
    this.flowExecutionHistoryTable.addGlobalSecondaryIndex({
      indexName: 'userId-startedAt-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'startedAt',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for status-startedAt
    this.flowExecutionHistoryTable.addGlobalSecondaryIndex({
      indexName: 'status-startedAt-index',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'startedAt',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for tenantId-flowType
    this.flowExecutionHistoryTable.addGlobalSecondaryIndex({
      indexName: 'tenantId-flowType-index',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'flowType',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ========================================
    // 3. Flow Step Execution History Table
    // ========================================
    // フローステップ実行履歴テーブル: 各ステップの実行詳細を記録
    this.flowStepExecutionHistoryTable = new dynamodb.Table(
      this,
      'FlowStepExecutionHistoryTable',
      {
        tableName: this.flowStepExecutionHistoryTableName,
        partitionKey: {
          name: 'flowExecutionId',
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: 'stepSequence',
          type: dynamodb.AttributeType.NUMBER,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: removalPolicy,
        timeToLiveAttribute: 'ttl',
      }
    );

    // Add tags
    cdk.Tags.of(this.flowStepExecutionHistoryTable).add(
      'TenantId',
      props.tenantId
    );
    cdk.Tags.of(this.flowStepExecutionHistoryTable).add(
      'Environment',
      environment
    );
    cdk.Tags.of(this.flowStepExecutionHistoryTable).add(
      'Purpose',
      'step-history'
    );

    // ========================================
    // 4. Outputs
    // ========================================
    new cdk.CfnOutput(this, 'IdempotencyTableName', {
      value: this.idempotencyTable.tableName,
      description: 'Idempotency table name',
    });

    new cdk.CfnOutput(this, 'FlowExecutionHistoryTableName', {
      value: this.flowExecutionHistoryTable.tableName,
      description: 'Flow execution history table name',
    });

    new cdk.CfnOutput(this, 'FlowStepExecutionHistoryTableName', {
      value: this.flowStepExecutionHistoryTable.tableName,
      description: 'Flow step execution history table name',
    });
  }
}
