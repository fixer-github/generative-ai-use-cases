/**
 * Tenant Authorization DB Stack
 * テナント専用の権限判定システムDBスタック
 *
 * このスタックは以下を作成します：
 * - DynamoDBテーブル（UsageEvent、PermissionGrant）
 *
 * Lambda関数は共通スタック（AuthorizationFunctionsStack）で管理されます
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AuthorizationDatabase } from '../../construct/authorization-database';

export interface TenantAuthorizationDbStackProps extends cdk.StackProps {
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
   * @default 'Authorization database for tenant {tenantId}'
   */
  readonly description?: string;
}

/**
 * Stack for creating tenant-specific authorization database
 */
export class TenantAuthorizationDbStack extends cdk.Stack {
  /**
   * The authorization database construct
   */
  public readonly authorizationDatabase: AuthorizationDatabase;

  constructor(
    scope: Construct,
    id: string,
    props: TenantAuthorizationDbStackProps
  ) {
    super(scope, id, props);

    // Create parameter if tenant ID not provided
    const tenantId =
      props.tenantId ||
      new cdk.CfnParameter(this, 'TenantId', {
        description: 'The tenant identifier for the authorization system',
        type: 'String',
        allowedPattern: '^[a-zA-Z0-9-]+$',
        constraintDescription:
          'Tenant ID must contain only alphanumeric characters and hyphens',
      }).valueAsString;

    // Get environment (required parameter)
    const environment = props.environment;

    // Create the authorization database construct
    this.authorizationDatabase = new AuthorizationDatabase(
      this,
      'AuthorizationDatabase',
      {
        tenantId,
        environment,
        removalPolicy: props.removalPolicy,
      }
    );

    // Add stack-level outputs with export names
    // DynamoDB Table outputs
    new cdk.CfnOutput(this, 'StackUsageEventTableArn', {
      value: this.authorizationDatabase.usageEventTable.tableArn,
      description: `ARN of the usage event table for tenant ${tenantId}`,
      exportName: `${this.stackName}-UsageEventTableArn`,
    });

    new cdk.CfnOutput(this, 'StackUsageEventTableName', {
      value: this.authorizationDatabase.usageEventTable.tableName,
      description: `Name of the usage event table for tenant ${tenantId}`,
      exportName: `${this.stackName}-UsageEventTableName`,
    });

    new cdk.CfnOutput(this, 'StackPermissionGrantTableArn', {
      value: this.authorizationDatabase.permissionGrantTable.tableArn,
      description: `ARN of the permission grant table for tenant ${tenantId}`,
      exportName: `${this.stackName}-PermissionGrantTableArn`,
    });

    new cdk.CfnOutput(this, 'StackPermissionGrantTableName', {
      value: this.authorizationDatabase.permissionGrantTable.tableName,
      description: `Name of the permission grant table for tenant ${tenantId}`,
      exportName: `${this.stackName}-PermissionGrantTableName`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', tenantId.toString());
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'TenantAuthorizationDatabase');

    // Set stack description
    this.templateOptions.description =
      props.description ||
      `Creates tenant-specific authorization database for tenant ${tenantId}`;
  }
}
