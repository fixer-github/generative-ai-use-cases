import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration } from 'aws-cdk-lib';
import {
  LambdaIntegration,
  RestApi,
  CognitoUserPoolsAuthorizer,
  AuthorizationType,
} from 'aws-cdk-lib/aws-apigateway';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { TenantManager } from '../../construct/tenant-manager';

export interface FlowExecutionManagementApiProps {
  /**
   * API Gateway REST API
   */
  readonly api: RestApi;

  /**
   * User Pool for authentication
   */
  readonly userPool: UserPool;

  /**
   * User Pool Client for authentication
   */
  readonly userPoolClient: UserPoolClient;

  /**
   * Identity Pool for authorization
   */
  readonly idPool: IdentityPool;

  /**
   * Tenant Manager for multi-tenant DynamoDB access
   */
  readonly tenantManager: TenantManager;

  /**
   * Environment name (e.g., dev, staging, prod)
   */
  readonly environment: string;
}

/**
 * Flow Execution Management API Construct
 *
 * Provides administrator-facing API endpoints for flow execution history management:
 * 1. List flow executions (with search, filter, pagination)
 * 2. Get flow execution details (including step executions)
 */
class FlowExecutionManagementApi extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: FlowExecutionManagementApiProps
  ) {
    super(scope, id);

    const {
      api,
      userPool,
      userPoolClient,
      idPool,
      tenantManager,
      environment,
    } = props;

    // Create Cognito authorizer
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'FlowExecutionManagementAuthorizer',
    });

    // Common Lambda configuration
    const commonLambdaConfig = {
      runtime: LAMBDA_RUNTIME_NODEJS,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
        IDENTITY_POOL_ID: idPool.identityPoolId,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        AWS_ACCOUNT_ID: process.env.CDK_DEFAULT_ACCOUNT || '',
        ENVIRONMENT: environment,
      },
    };

    // ========================================
    // 1. List Flow Executions
    // ========================================
    const listFlowExecutionsFunction = new NodejsFunction(
      this,
      'ListFlowExecutions',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/admin/flow-executions/listFlowExecutions.ts',
        functionName: `${environment}-billing-admin-list-flow-executions`,
      }
    );

    // ========================================
    // 2. Get Flow Execution Details
    // ========================================
    const getFlowExecutionFunction = new NodejsFunction(
      this,
      'GetFlowExecution',
      {
        ...commonLambdaConfig,
        entry:
          './lambda/billing/admin/flow-executions/getFlowExecution.ts',
        functionName: `${environment}-billing-admin-get-flow-execution`,
      }
    );

    // ========================================
    // IAM Permissions
    // ========================================
    const functions = [
      listFlowExecutionsFunction,
      getFlowExecutionFunction,
    ];

    functions.forEach((func) => {
      // Grant Tenants table read access
      tenantManager.tenantsTable.grantReadData(func);

      // Grant Cognito User Pool AdminGetUser permission for real-time role verification
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['cognito-idp:AdminGetUser'],
          resources: [userPool.userPoolArn],
        })
      );

      // Grant Cognito Identity Pool access for AssumeRoleWithWebIdentity
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'cognito-identity:GetId',
            'cognito-identity:GetOpenIdToken',
            'cognito-identity:GetCredentialsForIdentity',
          ],
          resources: ['*'],
        })
      );

      // Grant STS AssumeRoleWithWebIdentity permission
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRoleWithWebIdentity'],
          resources: ['*'],
        })
      );

      // Grant STS AssumeRole permission for cross-account access to tenant DynamoDB
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: [
            // テナントごとに異なるアカウントのロールを引き受ける可能性があるため、ワイルドカードを使用
            'arn:aws:iam::*:role/TenantRole-*',
          ],
        })
      );

      // Grant DynamoDB access for flow execution tables
      // Note: Actual table access is granted through assumed tenant role
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:Query',
            'dynamodb:Scan',
          ],
          resources: [
            'arn:aws:dynamodb:*:*:table/*-flow-execution-history',
            'arn:aws:dynamodb:*:*:table/*-flow-execution-history/index/*',
            'arn:aws:dynamodb:*:*:table/*-flow-step-execution-history',
          ],
        })
      );
    });

    // ========================================
    // API Gateway Endpoints
    // ========================================
    const adminResource = api.root.resourceForPath('/admin');
    // Get existing 'billing' resource or create if it doesn't exist
    const billingResource =
      adminResource.getResource('billing') ||
      adminResource.addResource('billing');
    const flowExecutionsResource = billingResource.addResource('flow-executions');

    // GET /admin/billing/flow-executions - List flow executions
    flowExecutionsResource.addMethod(
      'GET',
      new LambdaIntegration(listFlowExecutionsFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // GET /admin/billing/flow-executions/{flowExecutionId} - Get flow execution details
    const flowExecutionIdResource =
      flowExecutionsResource.addResource('{flowExecutionId}');
    flowExecutionIdResource.addMethod(
      'GET',
      new LambdaIntegration(getFlowExecutionFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );
  }
}

export default FlowExecutionManagementApi;
