/**
 * Authorization System Construct
 * 権限判定システムのConstruct
 *
 * テナント専用のDynamoDBテーブル、Lambda関数、EventBridge Schedulerを作成します
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export interface AuthorizationSystemProps {
  /**
   * The tenant identifier
   */
  readonly tenantId: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Tenant role ARN for cross-account access
   */
  readonly tenantRoleArn: string;

  /**
   * Removal policy for stateful resources
   * @default RemovalPolicy.RETAIN for production, DESTROY for dev
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
}

export class AuthorizationSystem extends Construct {
  /**
   * The usage counter table
   */
  public readonly usageCounterTable: dynamodb.Table;

  /**
   * The permission grant table
   */
  public readonly permissionGrantTable: dynamodb.Table;

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

  /**
   * Usage counter table name
   */
  public readonly usageCounterTableName: string;

  /**
   * Permission grant table name
   */
  public readonly permissionGrantTableName: string;

  constructor(scope: Construct, id: string, props: AuthorizationSystemProps) {
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
    this.usageCounterTableName = `UsageCounter-${environment}-tenant-${sanitizedTenantId}`;
    this.permissionGrantTableName = `PermissionGrant-${environment}-tenant-${sanitizedTenantId}`;

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
    // 2. Lambda Functions
    // ========================================

    const commonEnvironment = {
      ENVIRONMENT: environment,
    };

    const commonLambdaProps: Partial<NodejsFunction> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    };

    // Grant Permission Function
    this.grantPermissionFunction = new NodejsFunction(
      this,
      'GrantPermissionFunction',
      {
        ...commonLambdaProps,
        functionName: `${environment}-${sanitizedTenantId}-authorization-grant-permission`,
        entry: path.join(
          __dirname,
          '../../lambda/authorization/grantPermission.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description: 'Grant permissions to users',
      }
    );

    // Revoke Permission Function
    this.revokePermissionFunction = new NodejsFunction(
      this,
      'RevokePermissionFunction',
      {
        ...commonLambdaProps,
        entry: path.join(
          __dirname,
          '../../lambda/authorization/revokePermission.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description: 'Revoke permissions from users',
      }
    );

    // Check Permission Function
    this.checkPermissionFunction = new NodejsFunction(
      this,
      'CheckPermissionFunction',
      {
        ...commonLambdaProps,
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10), // Faster timeout for check operations
        memorySize: 256, // Lower memory for check operations
        entry: path.join(
          __dirname,
          '../../lambda/authorization/checkPermission.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description: 'Check if user has permission to access a feature',
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
        entry: path.join(
          __dirname,
          '../../lambda/authorization/incrementUsageCount.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description: 'Increment usage count for a feature',
      }
    );

    // Reset Usage Count Function
    this.resetUsageCountFunction = new NodejsFunction(
      this,
      'ResetUsageCountFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(15), // Long timeout for batch processing
        memorySize: 1024,
        entry: path.join(
          __dirname,
          '../../lambda/authorization/resetUsageCount.ts'
        ),
        handler: 'handler',
        environment: commonEnvironment,
        description: 'Reset usage counts for all tenants (scheduled)',
        bundling: {
          externalModules: ['@aws-sdk/*'],
        },
      }
    );

    // ========================================
    // 3. IAM Permissions
    // ========================================

    // Grant DynamoDB permissions to all functions
    [
      this.grantPermissionFunction,
      this.revokePermissionFunction,
      this.checkPermissionFunction,
      this.incrementUsageCountFunction,
      this.resetUsageCountFunction,
    ].forEach((fn) => {
      this.usageCounterTable.grantReadWriteData(fn);
      this.permissionGrantTable.grantReadWriteData(fn);
    });

    // Grant AssumeRole permissions to all functions
    const assumeRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: ['arn:aws:iam::*:role/TenantRole-*'],
    });

    [
      this.grantPermissionFunction,
      this.revokePermissionFunction,
      this.checkPermissionFunction,
      this.incrementUsageCountFunction,
      this.resetUsageCountFunction,
    ].forEach((fn) => {
      fn.addToRolePolicy(assumeRolePolicy);
    });

    // Grant OpenFGA API Gateway invoke permissions to all functions
    const openFgaInvokePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:Invoke'],
      resources: ['arn:aws:execute-api:*:*:*/prod/*'],
    });

    [
      this.grantPermissionFunction,
      this.revokePermissionFunction,
      this.checkPermissionFunction,
    ].forEach((fn) => {
      fn.addToRolePolicy(openFgaInvokePolicy);
    });

    // Grant SSM Parameter Store read permissions to all functions that need OpenFGA config
    // This allows Lambda functions to retrieve OpenFGA configuration from SSM after assuming tenant role
    const ssmParameterReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiEndpoint`,
        `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiRegion`,
        `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaStoreId`,
      ],
    });

    [
      this.grantPermissionFunction,
      this.revokePermissionFunction,
      this.checkPermissionFunction,
    ].forEach((fn) => {
      fn.addToRolePolicy(ssmParameterReadPolicy);
    });

    // Grant tenant manager table read permissions for reset function
    const tenantTableReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
      resources: [
        `arn:aws:dynamodb:${cdk.Stack.of(this).region}:${
          cdk.Stack.of(this).account
        }:table/TenantManager-${environment}`,
      ],
    });

    this.resetUsageCountFunction.addToRolePolicy(tenantTableReadPolicy);

    // ========================================
    // 4. EventBridge Scheduler Rules
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
    // 5. Outputs
    // ========================================

    new cdk.CfnOutput(this, 'UsageCounterTableName', {
      value: this.usageCounterTable.tableName,
      description: 'Usage counter table name',
    });

    new cdk.CfnOutput(this, 'PermissionGrantTableName', {
      value: this.permissionGrantTable.tableName,
      description: 'Permission grant table name',
    });

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
