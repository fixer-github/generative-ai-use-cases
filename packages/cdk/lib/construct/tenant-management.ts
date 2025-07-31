import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { AuthorizationType, CognitoUserPoolsAuthorizer, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

export interface TenantManagementProps {
  /**
   * The API Gateway REST API to add tenant management endpoints to
   */
  readonly api: RestApi;

  /**
   * The Cognito User Pool for authentication
   */
  readonly userPool: UserPool;

  /**
   * The User Pool authorizer
   */
  readonly authorizer: CognitoUserPoolsAuthorizer;
}

/**
 * Construct for tenant management functionality
 */
export class TenantManagement extends Construct {
  /**
   * Lambda function for onboarding new tenants
   */
  public readonly onboardTenantFunction: NodejsFunction;

  /**
   * Lambda function for getting tenant status
   */
  public readonly getTenantStatusFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: TenantManagementProps) {
    super(scope, id);

    const { api, userPool, authorizer } = props;

    // Lambda function for tenant onboarding
    this.onboardTenantFunction = new NodejsFunction(this, 'OnboardTenant', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/onboardTenant.ts',
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
      },
    });

    // Grant permissions to create CloudFormation stacks and DynamoDB tables
    this.onboardTenantFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:DescribeStacks',
          'cloudformation:ListStacks',
        ],
        resources: [
          `arn:aws:cloudformation:${Stack.of(this).region}:${Stack.of(this).account}:stack/TenantDynamoDB-*/*`,
        ],
      })
    );

    // Grant permissions to manage DynamoDB tables
    this.onboardTenantFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:CreateTable',
          'dynamodb:DescribeTable',
          'dynamodb:ListTables',
          'dynamodb:TagResource',
        ],
        resources: [
          `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/*-tenant-*`,
        ],
      })
    );

    // Lambda function for getting tenant status
    this.getTenantStatusFunction = new NodejsFunction(this, 'GetTenantStatus', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getTenantStatus.ts',
      timeout: Duration.minutes(1),
      memorySize: 256,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
      },
    });

    // Grant permissions to describe stacks and tables
    this.getTenantStatusFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
        ],
        resources: [
          `arn:aws:cloudformation:${Stack.of(this).region}:${Stack.of(this).account}:stack/TenantDynamoDB-*/*`,
        ],
      })
    );

    this.getTenantStatusFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:DescribeTable',
        ],
        resources: [
          `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/*-tenant-*`,
        ],
      })
    );

    // API Gateway endpoints
    const tenantsResource = api.root.addResource('tenants');

    // POST /tenants - Onboard a new tenant
    tenantsResource.addMethod(
      'POST',
      new LambdaIntegration(this.onboardTenantFunction),
      {
        authorizationType: AuthorizationType.COGNITO,
        authorizer,
      }
    );

    // GET /tenants/{tenantId} - Get tenant status
    const tenantResource = tenantsResource.addResource('{tenantId}');
    tenantResource.addMethod(
      'GET',
      new LambdaIntegration(this.getTenantStatusFunction),
      {
        authorizationType: AuthorizationType.COGNITO,
        authorizer,
      }
    );
  }
}