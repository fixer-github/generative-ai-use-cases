/**
 * Authorization Functions Stack
 * 権限判定システムのLambda関数共通スタック
 *
 * このスタックは以下を作成します：
 * - Lambda関数（権限付与、剥奪、チェック、使用イベント記録）
 *
 * DynamoDBテーブルはテナント専用スタック（TenantAuthorizationDbStack）で管理されます
 * Lambda関数はAssumeRoleパターンを使用して各テナントのDBにアクセスします
 */

import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AuthorizationFunctions } from '../../construct/authorization-functions';

export interface AuthorizationFunctionsStackProps extends cdk.StackProps {
  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Tenants table name (for getTenant function)
   */
  readonly tenantsTableName: string;

  /**
   * Shared IAM role for background job Lambda functions
   * This role is used by grantPermission Lambda that needs to AssumeRole to TenantRole-*
   * for cross-account/cross-tenant access
   */
  readonly backgroundJobRole?: iam.IRole;

  /**
   * Description for the stack
   * @default 'Authorization functions stack (shared across all tenants)'
   */
  readonly description?: string;
}

/**
 * Stack for creating shared authorization functions
 */
export class AuthorizationFunctionsStack extends cdk.Stack {
  /**
   * The authorization functions construct
   */
  public readonly authorizationFunctions: AuthorizationFunctions;

  constructor(
    scope: Construct,
    id: string,
    props: AuthorizationFunctionsStackProps
  ) {
    super(scope, id, props);

    const environment = props.environment;

    // Create the authorization functions construct
    this.authorizationFunctions = new AuthorizationFunctions(
      this,
      'AuthorizationFunctions',
      {
        environment,
        tenantsTableName: props.tenantsTableName,
        backgroundJobRole: props.backgroundJobRole,
      }
    );

    // Add stack-level outputs with export names
    new cdk.CfnOutput(this, 'StackGrantPermissionFunctionArn', {
      value: this.authorizationFunctions.grantPermissionFunction.functionArn,
      description: 'ARN of the grant permission Lambda function',
      exportName: `${this.stackName}-GrantPermissionFunctionArn`,
    });

    new cdk.CfnOutput(this, 'StackRevokePermissionFunctionArn', {
      value: this.authorizationFunctions.revokePermissionFunction.functionArn,
      description: 'ARN of the revoke permission Lambda function',
      exportName: `${this.stackName}-RevokePermissionFunctionArn`,
    });

    new cdk.CfnOutput(this, 'StackCheckPermissionFunctionArn', {
      value: this.authorizationFunctions.checkPermissionFunction.functionArn,
      description: 'ARN of the check permission Lambda function',
      exportName: `${this.stackName}-CheckPermissionFunctionArn`,
    });

    new cdk.CfnOutput(this, 'StackIncrementUsageCountFunctionArn', {
      value:
        this.authorizationFunctions.incrementUsageCountFunction.functionArn,
      description: 'ARN of the record usage event Lambda function',
      exportName: `${this.stackName}-IncrementUsageCountFunctionArn`,
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'AuthorizationFunctions');

    // Set stack description
    this.templateOptions.description =
      props.description ||
      'Authorization functions stack (shared across all tenants)';
  }
}
