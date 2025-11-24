/**
 * Tenant Authorization Stack
 * テナント専用の権限判定システムのスタック
 *
 * このスタックは以下を作成します：
 * - DynamoDBテーブル（UsageCounter、PermissionGrant）
 * - Lambda関数（権限付与、剥奪、チェック、カウント加算、リセット）
 * - EventBridge Schedulerルール（日次・月次リセット）
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AuthorizationSystem } from '../../construct/authorization-system';

export interface TenantAuthorizationStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId?: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Tenant role ARN for cross-account access
   */
  readonly tenantRoleArn: string;

  /**
   * Tenants table name (for getTenant function)
   */
  readonly tenantsTableName: string;

  /**
   * Removal policy for stateful resources
   * @default RemovalPolicy.RETAIN for production, DESTROY for dev
   */
  readonly removalPolicy?: cdk.RemovalPolicy;

  /**
   * Description for the stack
   * @default 'Authorization system for tenant {tenantId}'
   */
  readonly description?: string;
}

/**
 * Stack for creating tenant-specific authorization system
 */
export class TenantAuthorizationStack extends cdk.Stack {
  /**
   * The authorization system construct
   */
  public readonly authorizationSystem: AuthorizationSystem;

  constructor(
    scope: Construct,
    id: string,
    props: TenantAuthorizationStackProps
  ) {
    super(scope, id, props);

    // Create parameter if tenant ID not provided
    const tenantId =
      props.tenantId ||
      new cdk.CfnParameter(this, 'TenantId', {
        description:
          'The tenant identifier for the authorization system',
        type: 'String',
        allowedPattern: '^[a-zA-Z0-9-]+$',
        constraintDescription:
          'Tenant ID must contain only alphanumeric characters and hyphens',
      }).valueAsString;

    // Get environment (required parameter)
    const environment = props.environment;

    // Create the authorization system construct
    this.authorizationSystem = new AuthorizationSystem(
      this,
      'AuthorizationSystem',
      {
        tenantId,
        environment,
        tenantRoleArn: props.tenantRoleArn,
        tenantsTableName: props.tenantsTableName,
        removalPolicy: props.removalPolicy,
      }
    );

    // Add stack-level outputs with export names
    // DynamoDB Table outputs
    new cdk.CfnOutput(this, 'StackUsageCounterTableArn', {
      value: this.authorizationSystem.usageCounterTable.tableArn,
      description: `ARN of the usage counter table for tenant ${tenantId}`,
      exportName: `${this.stackName}-UsageCounterTableArn`,
    });

    new cdk.CfnOutput(this, 'StackUsageCounterTableName', {
      value: this.authorizationSystem.usageCounterTable.tableName,
      description: `Name of the usage counter table for tenant ${tenantId}`,
      exportName: `${this.stackName}-UsageCounterTableName`,
    });

    new cdk.CfnOutput(this, 'StackPermissionGrantTableArn', {
      value: this.authorizationSystem.permissionGrantTable.tableArn,
      description: `ARN of the permission grant table for tenant ${tenantId}`,
      exportName: `${this.stackName}-PermissionGrantTableArn`,
    });

    new cdk.CfnOutput(this, 'StackPermissionGrantTableName', {
      value: this.authorizationSystem.permissionGrantTable.tableName,
      description: `Name of the permission grant table for tenant ${tenantId}`,
      exportName: `${this.stackName}-PermissionGrantTableName`,
    });

    // Lambda Function outputs
    new cdk.CfnOutput(this, 'StackGrantPermissionFunctionArn', {
      value: this.authorizationSystem.grantPermissionFunction.functionArn,
      description: `ARN of the grant permission Lambda function for tenant ${tenantId}`,
      exportName: `${this.stackName}-GrantPermissionFunctionArn`,
    });

    new cdk.CfnOutput(this, 'StackRevokePermissionFunctionArn', {
      value: this.authorizationSystem.revokePermissionFunction.functionArn,
      description: `ARN of the revoke permission Lambda function for tenant ${tenantId}`,
      exportName: `${this.stackName}-RevokePermissionFunctionArn`,
    });

    new cdk.CfnOutput(this, 'StackCheckPermissionFunctionArn', {
      value: this.authorizationSystem.checkPermissionFunction.functionArn,
      description: `ARN of the check permission Lambda function for tenant ${tenantId}`,
      exportName: `${this.stackName}-CheckPermissionFunctionArn`,
    });

    new cdk.CfnOutput(this, 'StackIncrementUsageCountFunctionArn', {
      value:
        this.authorizationSystem.incrementUsageCountFunction.functionArn,
      description: `ARN of the increment usage count Lambda function for tenant ${tenantId}`,
      exportName: `${this.stackName}-IncrementUsageCountFunctionArn`,
    });

    new cdk.CfnOutput(this, 'StackResetUsageCountFunctionArn', {
      value: this.authorizationSystem.resetUsageCountFunction.functionArn,
      description: `ARN of the reset usage count Lambda function for tenant ${tenantId}`,
      exportName: `${this.stackName}-ResetUsageCountFunctionArn`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', tenantId.toString());
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'TenantAuthorizationSystem');

    // Set stack description
    this.templateOptions.description =
      props.description ||
      `Creates tenant-specific authorization system for tenant ${tenantId}`;
  }
}
