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
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface PlanManagementApiProps {
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
   * Tenant Manager for multi-tenant RDS access
   */
  readonly tenantManager: TenantManager;

  /**
   * Environment name (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * VPC for Lambda functions (optional, required for RDS access)
   */
  readonly vpc?: ec2.IVpc;

  /**
   * Security group for Lambda functions (optional, required for RDS access)
   */
  readonly securityGroup?: ec2.ISecurityGroup;
}

/**
 * Plan Management API Construct
 *
 * Provides administrator-facing API endpoints for plan management:
 * 1. List plans (with search, filter, sort, pagination)
 * 2. Get plan details
 * 3. Create plan
 * 4. Update plan status
 * 5. Get plan change history
 * 6. Get plan subscription statistics
 * 7. Check internal name availability
 *
 * Also provides internal Lambda functions for orchestrator:
 * 1. applyPlanToUser - Apply plan to user
 * 2. terminatePlanApplication - Terminate plan application
 * 3. updatePlanApplicationStatus - Update plan application status
 */
class PlanManagementApi extends Construct {
  /**
   * Internal Lambda functions for orchestrator
   * These are not exposed via API Gateway
   */
  public readonly internalFunctions: {
    applyPlanToUser: NodejsFunction;
    terminatePlanApplication: NodejsFunction;
    updatePlanApplicationStatus: NodejsFunction;
  };

  constructor(scope: Construct, id: string, props: PlanManagementApiProps) {
    super(scope, id);

    const {
      api,
      userPool,
      userPoolClient,
      idPool,
      tenantManager,
      environment,
      vpc,
      securityGroup,
    } = props;

    // Create Cognito authorizer
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'PlanManagementAuthorizer',
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
      ...(vpc && securityGroup
        ? {
            vpc,
            securityGroups: [securityGroup],
            vpcSubnets: {
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
          }
        : {}),
    };

    // ========================================
    // Internal Lambda Functions (for Orchestrator)
    // ========================================

    // Internal: Apply Plan to User
    const applyPlanToUserFunction = new NodejsFunction(
      this,
      'InternalApplyPlanToUser',
      {
        ...commonLambdaConfig,
        entry: './lambda/billing/plan-management/applyPlanToUser.ts',
        functionName: `${environment}-billing-plan-internal-apply`,
      }
    );

    // Internal: Terminate Plan Application
    const terminatePlanApplicationFunction = new NodejsFunction(
      this,
      'InternalTerminatePlanApplication',
      {
        ...commonLambdaConfig,
        entry: './lambda/billing/plan-management/terminatePlanApplication.ts',
        functionName: `${environment}-billing-plan-internal-terminate`,
      }
    );

    // Internal: Update Plan Application Status
    const updatePlanApplicationStatusFunction = new NodejsFunction(
      this,
      'InternalUpdatePlanApplicationStatus',
      {
        ...commonLambdaConfig,
        entry: './lambda/billing/plan-management/updatePlanApplicationStatus.ts',
        functionName: `${environment}-billing-plan-internal-update-status`,
      }
    );

    // Export internal functions for orchestrator
    this.internalFunctions = {
      applyPlanToUser: applyPlanToUserFunction,
      terminatePlanApplication: terminatePlanApplicationFunction,
      updatePlanApplicationStatus: updatePlanApplicationStatusFunction,
    };

    // ========================================
    // 1. List Plans
    // ========================================
    const listPlansFunction = new NodejsFunction(this, 'ListPlans', {
      ...commonLambdaConfig,
      entry: './lambda/billing/admin/plan-management/listPlans.ts',
      functionName: `${environment}-billing-admin-list-plans`,
    });

    // ========================================
    // 2. Get Plan Details
    // ========================================
    const getPlanFunction = new NodejsFunction(this, 'GetPlan', {
      ...commonLambdaConfig,
      entry: './lambda/billing/admin/plan-management/getPlan.ts',
      functionName: `${environment}-billing-admin-get-plan`,
    });

    // ========================================
    // 3. Create Plan
    // ========================================
    const createPlanFunction = new NodejsFunction(this, 'CreatePlan', {
      ...commonLambdaConfig,
      entry: './lambda/billing/admin/plan-management/createPlan.ts',
      functionName: `${environment}-billing-admin-create-plan`,
    });

    // ========================================
    // 4. Update Plan Status
    // ========================================
    const updatePlanStatusFunction = new NodejsFunction(
      this,
      'UpdatePlanStatus',
      {
        ...commonLambdaConfig,
        entry: './lambda/billing/admin/plan-management/updatePlanStatus.ts',
        functionName: `${environment}-billing-admin-update-plan-status`,
      }
    );

    // ========================================
    // 4.1 Set Default Plan
    // ========================================
    const setDefaultPlanFunction = new NodejsFunction(
      this,
      'SetDefaultPlan',
      {
        ...commonLambdaConfig,
        entry: './lambda/billing/admin/plan-management/setDefaultPlan.ts',
        functionName: `${environment}-billing-admin-set-default-plan`,
      }
    );

    // ========================================
    // 5. Get Plan Change History
    // ========================================
    const getPlanHistoryFunction = new NodejsFunction(this, 'GetPlanHistory', {
      ...commonLambdaConfig,
      entry: './lambda/billing/admin/plan-management/getPlanHistory.ts',
      functionName: `${environment}-billing-admin-get-plan-history`,
    });

    // ========================================
    // 6. Get Plan Subscription Statistics
    // ========================================
    const getPlanSubscriptionsFunction = new NodejsFunction(
      this,
      'GetPlanSubscriptions',
      {
        ...commonLambdaConfig,
        entry: './lambda/billing/admin/plan-management/getPlanSubscriptions.ts',
        functionName: `${environment}-billing-admin-get-plan-subscriptions`,
      }
    );

    // ========================================
    // 7. Check Internal Name Availability
    // ========================================
    const checkPlanNameFunction = new NodejsFunction(this, 'CheckPlanName', {
      ...commonLambdaConfig,
      entry: './lambda/billing/admin/plan-management/checkPlanName.ts',
      functionName: `${environment}-billing-admin-check-plan-name`,
    });

    // ========================================
    // IAM Permissions
    // ========================================
    const functions = [
      // Admin functions
      listPlansFunction,
      getPlanFunction,
      createPlanFunction,
      updatePlanStatusFunction,
      setDefaultPlanFunction,
      getPlanHistoryFunction,
      getPlanSubscriptionsFunction,
      checkPlanNameFunction,
      // Internal functions
      applyPlanToUserFunction,
      terminatePlanApplicationFunction,
      updatePlanApplicationStatusFunction,
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

      // Grant RDS IAM authentication permission
      func.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['rds-db:connect'],
          resources: ['*'], // Tenant-specific resources will be constrained by assumed role
        })
      );
    });

    // ========================================
    // API Gateway Endpoints
    // ========================================
    const adminResource = api.root.resourceForPath('/admin');
    const billingResource = adminResource.addResource('billing');
    const plansResource = billingResource.addResource('plans');

    // GET /admin/billing/plans - List plans
    plansResource.addMethod('GET', new LambdaIntegration(listPlansFunction), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });

    // POST /admin/billing/plans - Create plan
    plansResource.addMethod('POST', new LambdaIntegration(createPlanFunction), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });

    // GET /admin/billing/plans/check-name - Check internal name availability
    const checkNameResource = plansResource.addResource('check-name');
    checkNameResource.addMethod(
      'GET',
      new LambdaIntegration(checkPlanNameFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // GET /admin/billing/plans/{plan_id} - Get plan details
    const planIdResource = plansResource.addResource('{plan_id}');
    planIdResource.addMethod('GET', new LambdaIntegration(getPlanFunction), {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
    });

    // PATCH /admin/billing/plans/{plan_id}/status - Update plan status
    const statusResource = planIdResource.addResource('status');
    statusResource.addMethod(
      'PATCH',
      new LambdaIntegration(updatePlanStatusFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // PUT /admin/billing/plans/{plan_id}/default - Set default plan
    const defaultResource = planIdResource.addResource('default');
    defaultResource.addMethod(
      'PUT',
      new LambdaIntegration(setDefaultPlanFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // GET /admin/billing/plans/{plan_id}/history - Get plan change history
    const historyResource = planIdResource.addResource('history');
    historyResource.addMethod(
      'GET',
      new LambdaIntegration(getPlanHistoryFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );

    // GET /admin/billing/plans/{plan_id}/subscriptions - Get plan subscription statistics
    const subscriptionsResource = planIdResource.addResource('subscriptions');
    subscriptionsResource.addMethod(
      'GET',
      new LambdaIntegration(getPlanSubscriptionsFunction),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
      }
    );
  }
}

export default PlanManagementApi;
