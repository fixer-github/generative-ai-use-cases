/**
 * Tenant Orchestration DB Stack
 * テナント専用のオーケストレーションDBスタック
 *
 * このスタックは以下を作成します：
 * - DynamoDBテーブル（Idempotency、FlowExecutionHistory、FlowStepExecutionHistory）
 *
 * Lambda関数は共通スタック（OrchestrationApi）で管理されます
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { OrchestrationDatabase } from '../../construct/orchestration-database';

export interface TenantOrchestrationDbStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId?: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Removal policy for stateful resources
   * @default RemovalPolicy.RETAIN for production, DESTROY for dev
   */
  readonly removalPolicy?: cdk.RemovalPolicy;

  /**
   * Description for the stack
   * @default 'Orchestration database for tenant {tenantId}'
   */
  readonly description?: string;
}

/**
 * Stack for creating tenant-specific orchestration database
 */
export class TenantOrchestrationDbStack extends cdk.Stack {
  /**
   * The orchestration database construct
   */
  public readonly orchestrationDatabase: OrchestrationDatabase;

  constructor(
    scope: Construct,
    id: string,
    props: TenantOrchestrationDbStackProps
  ) {
    super(scope, id, props);

    // Create parameter if tenant ID not provided
    const tenantId =
      props.tenantId ||
      new cdk.CfnParameter(this, 'TenantId', {
        description: 'The tenant identifier for the orchestration system',
        type: 'String',
        allowedPattern: '^[a-zA-Z0-9-]+$',
        constraintDescription:
          'Tenant ID must contain only alphanumeric characters and hyphens',
      }).valueAsString;

    // Get environment (required parameter)
    const environment = props.environment;

    // Create the orchestration database construct
    this.orchestrationDatabase = new OrchestrationDatabase(
      this,
      'OrchestrationDatabase',
      {
        tenantId,
        environment,
        removalPolicy: props.removalPolicy,
      }
    );

    // Add stack-level outputs with export names
    // Idempotency Table outputs
    new cdk.CfnOutput(this, 'StackIdempotencyTableArn', {
      value: this.orchestrationDatabase.idempotencyTable.tableArn,
      description: `ARN of the idempotency table for tenant ${tenantId}`,
      exportName: `${this.stackName}-IdempotencyTableArn`,
    });

    new cdk.CfnOutput(this, 'StackIdempotencyTableName', {
      value: this.orchestrationDatabase.idempotencyTable.tableName,
      description: `Name of the idempotency table for tenant ${tenantId}`,
      exportName: `${this.stackName}-IdempotencyTableName`,
    });

    // Flow Execution History Table outputs
    new cdk.CfnOutput(this, 'StackFlowExecutionHistoryTableArn', {
      value: this.orchestrationDatabase.flowExecutionHistoryTable.tableArn,
      description: `ARN of the flow execution history table for tenant ${tenantId}`,
      exportName: `${this.stackName}-FlowExecutionHistoryTableArn`,
    });

    new cdk.CfnOutput(this, 'StackFlowExecutionHistoryTableName', {
      value: this.orchestrationDatabase.flowExecutionHistoryTable.tableName,
      description: `Name of the flow execution history table for tenant ${tenantId}`,
      exportName: `${this.stackName}-FlowExecutionHistoryTableName`,
    });

    // Flow Step Execution History Table outputs
    new cdk.CfnOutput(this, 'StackFlowStepExecutionHistoryTableArn', {
      value: this.orchestrationDatabase.flowStepExecutionHistoryTable.tableArn,
      description: `ARN of the flow step execution history table for tenant ${tenantId}`,
      exportName: `${this.stackName}-FlowStepExecutionHistoryTableArn`,
    });

    new cdk.CfnOutput(this, 'StackFlowStepExecutionHistoryTableName', {
      value:
        this.orchestrationDatabase.flowStepExecutionHistoryTable.tableName,
      description: `Name of the flow step execution history table for tenant ${tenantId}`,
      exportName: `${this.stackName}-FlowStepExecutionHistoryTableName`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', tenantId.toString());
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'TenantOrchestrationDatabase');

    // Set stack description
    this.templateOptions.description =
      props.description ||
      `Creates tenant-specific orchestration database for tenant ${tenantId}`;
  }
}
