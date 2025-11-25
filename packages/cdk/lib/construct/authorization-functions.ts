/**
 * Authorization Functions Construct
 * 権限判定システムのLambda関数・EventBridge定義
 *
 * 共通スタックで使用されるLambda関数とEventBridgeスケジューラを作成します
 * Lambda関数は動的テナント解決とAssumeRoleパターンを使用して各テナントDBにアクセスします
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import {
  NodejsFunction,
  NodejsFunctionProps,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export interface AuthorizationFunctionsProps {
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
}

export class AuthorizationFunctions extends Construct {
  /**
   * Grant permission Lambda function
   */
  public readonly grantPermissionFunction: lambda.Function;

  /**
   * Revoke permission Lambda function
   */
  public readonly revokePermissionFunction: lambda.Function;

  /**
   * Check permission Lambda function
   */
  public readonly checkPermissionFunction: lambda.Function;

  /**
   * Increment usage count Lambda function
   */
  public readonly incrementUsageCountFunction: lambda.Function;

  /**
   * Reset usage count Lambda function
   */
  public readonly resetUsageCountFunction: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    props: AuthorizationFunctionsProps
  ) {
    super(scope, id);

    const environment = props.environment || 'dev';

    // ========================================
    // 1. Lambda Functions
    // ========================================

    const commonEnvironment = {
      ENVIRONMENT: environment,
      TENANTS_TABLE_NAME: props.tenantsTableName,
    };

    const commonLambdaProps: Partial<NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    };

    // Grant Permission Function
    // Use backgroundJobRole if provided (for cross-tenant access via AssumeRole)
    this.grantPermissionFunction = new NodejsFunction(
      this,
      'GrantPermissionFunction',
      {
        ...commonLambdaProps,
        functionName: `${environment}-authorization-grant-permission`,
        entry: path.join(
          __dirname,
          '../../lambda/authorization/grantPermission.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description: 'Grant permissions to users (shared across all tenants)',
        ...(props.backgroundJobRole ? { role: props.backgroundJobRole } : {}),
      }
    );

    // Revoke Permission Function
    this.revokePermissionFunction = new NodejsFunction(
      this,
      'RevokePermissionFunction',
      {
        ...commonLambdaProps,
        functionName: `${environment}-authorization-revoke-permission`,
        entry: path.join(
          __dirname,
          '../../lambda/authorization/revokePermission.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description:
          'Revoke permissions from users (shared across all tenants)',
      }
    );

    // Check Permission Function
    this.checkPermissionFunction = new NodejsFunction(
      this,
      'CheckPermissionFunction',
      {
        ...commonLambdaProps,
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        functionName: `${environment}-authorization-check-permission`,
        entry: path.join(
          __dirname,
          '../../lambda/authorization/checkPermission.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description:
          'Check if user has permission to access a feature (shared across all tenants)',
      }
    );

    // Increment Usage Count Function
    this.incrementUsageCountFunction = new NodejsFunction(
      this,
      'IncrementUsageCountFunction',
      {
        ...commonLambdaProps,
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(5),
        memorySize: 256,
        functionName: `${environment}-authorization-increment-usage`,
        entry: path.join(
          __dirname,
          '../../lambda/authorization/incrementUsageCount.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description:
          'Increment usage count for a feature (shared across all tenants)',
      }
    );

    // Reset Usage Count Function
    this.resetUsageCountFunction = new NodejsFunction(
      this,
      'ResetUsageCountFunction',
      {
        ...commonLambdaProps,
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(15),
        memorySize: 1024,
        functionName: `${environment}-authorization-reset-usage`,
        entry: path.join(
          __dirname,
          '../../lambda/authorization/resetUsageCount.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description:
          'Reset usage counts for all tenants (scheduled, shared across all tenants)',
      }
    );

    // ========================================
    // 2. IAM Permissions (AssumeRole pattern)
    // ========================================
    // Note: If backgroundJobRole is provided, grantPermissionFunction uses that role
    // and its permissions are managed in the parent stack (GenerativeAiUseCasesStack).
    // We only add policies to functions with their own roles.

    const useBackgroundJobRole = !!props.backgroundJobRole;

    // Functions that need their own policies (excludes grantPermissionFunction if using backgroundJobRole)
    const functionsNeedingAssumeRole = useBackgroundJobRole
      ? [
          this.revokePermissionFunction,
          this.checkPermissionFunction,
          this.incrementUsageCountFunction,
          this.resetUsageCountFunction,
        ]
      : [
          this.grantPermissionFunction,
          this.revokePermissionFunction,
          this.checkPermissionFunction,
          this.incrementUsageCountFunction,
          this.resetUsageCountFunction,
        ];

    const functionsNeedingOpenFga = useBackgroundJobRole
      ? [this.revokePermissionFunction, this.checkPermissionFunction]
      : [
          this.grantPermissionFunction,
          this.revokePermissionFunction,
          this.checkPermissionFunction,
        ];

    // Grant AssumeRole permissions to all functions
    // Lambda functions will assume TenantRole to access tenant-specific DynamoDB tables
    const assumeRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: ['arn:aws:iam::*:role/TenantRole-*'],
    });

    functionsNeedingAssumeRole.forEach((fn) => {
      fn.addToRolePolicy(assumeRolePolicy);
    });

    // Grant OpenFGA API Gateway invoke permissions to all functions
    const openFgaInvokePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:Invoke'],
      resources: ['arn:aws:execute-api:*:*:*/prod/*'],
    });

    functionsNeedingOpenFga.forEach((fn) => {
      fn.addToRolePolicy(openFgaInvokePolicy);
    });

    // Grant SSM Parameter Store read permissions to all functions that need OpenFGA config
    const ssmParameterReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiEndpoint`,
        `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiRegion`,
        `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaStoreId`,
      ],
    });

    functionsNeedingOpenFga.forEach((fn) => {
      fn.addToRolePolicy(ssmParameterReadPolicy);
    });

    // Grant tenant manager table read permissions for all functions
    const tenantTableReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${cdk.Stack.of(this).region}:${
          cdk.Stack.of(this).account
        }:table/${props.tenantsTableName}`,
      ],
    });

    functionsNeedingAssumeRole.forEach((fn) => {
      fn.addToRolePolicy(tenantTableReadPolicy);
    });

    // ========================================
    // 3. EventBridge Scheduler Rules
    // ========================================

    // Daily reset rule (every day at 00:00 UTC)
    const dailyResetRule = new events.Rule(this, 'DailyUsageCountResetRule', {
      ruleName: `DailyUsageCountReset-${environment}`,
      description: 'Reset daily usage counts at midnight UTC',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '0',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    dailyResetRule.addTarget(
      new targets.LambdaFunction(this.resetUsageCountFunction, {
        event: events.RuleTargetInput.fromObject({
          periodType: 'daily',
        }),
        retryAttempts: 2,
      })
    );

    // Monthly reset rule (first day of every month at 00:00 UTC)
    const monthlyResetRule = new events.Rule(
      this,
      'MonthlyUsageCountResetRule',
      {
        ruleName: `MonthlyUsageCountReset-${environment}`,
        description: 'Reset monthly usage counts on the 1st of each month UTC',
        schedule: events.Schedule.cron({
          minute: '0',
          hour: '0',
          day: '1',
          month: '*',
          year: '*',
        }),
      }
    );

    monthlyResetRule.addTarget(
      new targets.LambdaFunction(this.resetUsageCountFunction, {
        event: events.RuleTargetInput.fromObject({
          periodType: 'monthly',
        }),
        retryAttempts: 2,
      })
    );

    // ========================================
    // 4. Outputs
    // ========================================

    new cdk.CfnOutput(this, 'GrantPermissionFunctionArn', {
      value: this.grantPermissionFunction.functionArn,
      description: 'Grant permission Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'RevokePermissionFunctionArn', {
      value: this.revokePermissionFunction.functionArn,
      description: 'Revoke permission Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'CheckPermissionFunctionArn', {
      value: this.checkPermissionFunction.functionArn,
      description: 'Check permission Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'IncrementUsageCountFunctionArn', {
      value: this.incrementUsageCountFunction.functionArn,
      description: 'Increment usage count Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'ResetUsageCountFunctionArn', {
      value: this.resetUsageCountFunction.functionArn,
      description: 'Reset usage count Lambda function ARN',
    });
  }
}
