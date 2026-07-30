import { Duration } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';
import { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { ModelConfiguration } from 'generative-ai-use-cases';

export interface AdminApiProps {
  readonly userPool: UserPool;
  readonly api: RestApi;
  // License (cash-based usage limit)
  readonly licenseTable: ITable;
  readonly modelIds: ModelConfiguration[];
  readonly vpc?: IVpc;
  readonly securityGroups?: ISecurityGroup[];
}

export class AdminApi extends Construct {
  constructor(scope: Construct, id: string, props: AdminApiProps) {
    super(scope, id);

    const { userPool, api, vpc, securityGroups } = props;

    const authorizer = new CognitoUserPoolsAuthorizer(this, 'AdminAuthorizer', {
      cognitoUserPools: [userPool],
    });

    const commonAuthorizerProps = {
      authorizationType: AuthorizationType.COGNITO,
      authorizer,
    };

    const commonEnv = {
      USER_POOL_ID: userPool.userPoolId,
    };

    const cognitoAdminPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:DescribeUserPool',
        'cognito-idp:UpdateUserPool',
        'cognito-idp:AdminSetUserMFAPreference',
      ],
      resources: [userPool.userPoolArn],
    });

    // --- Lambda Functions ---

    const listUsersFunction = new NodejsFunction(this, 'ListUsers', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/admin/listUsers.ts',
      timeout: Duration.minutes(1),
      environment: commonEnv,
      vpc,
      securityGroups,
    });
    listUsersFunction.addToRolePolicy(cognitoAdminPolicy);

    const createUserFunction = new NodejsFunction(this, 'CreateUser', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/admin/createUser.ts',
      timeout: Duration.minutes(1),
      environment: commonEnv,
      bundling: {
        nodeModules: ['@aws-sdk/client-cognito-identity-provider'],
      },
      vpc,
      securityGroups,
    });
    createUserFunction.addToRolePolicy(cognitoAdminPolicy);

    const disableUserFunction = new NodejsFunction(this, 'DisableUser', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/admin/disableUser.ts',
      timeout: Duration.minutes(1),
      environment: commonEnv,
      bundling: {
        nodeModules: ['@aws-sdk/client-cognito-identity-provider'],
      },
      vpc,
      securityGroups,
    });
    disableUserFunction.addToRolePolicy(cognitoAdminPolicy);

    const enableUserFunction = new NodejsFunction(this, 'EnableUser', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/admin/enableUser.ts',
      timeout: Duration.minutes(1),
      environment: commonEnv,
      bundling: {
        nodeModules: ['@aws-sdk/client-cognito-identity-provider'],
      },
      vpc,
      securityGroups,
    });
    enableUserFunction.addToRolePolicy(cognitoAdminPolicy);

    const deleteUserFunction = new NodejsFunction(this, 'DeleteUser', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/admin/deleteUser.ts',
      timeout: Duration.minutes(1),
      environment: commonEnv,
      bundling: {
        nodeModules: ['@aws-sdk/client-cognito-identity-provider'],
      },
      vpc,
      securityGroups,
    });
    deleteUserFunction.addToRolePolicy(cognitoAdminPolicy);

    const updateUserGroupsFunction = new NodejsFunction(
      this,
      'UpdateUserGroups',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/admin/updateUserGroups.ts',
        timeout: Duration.minutes(1),
        environment: commonEnv,
        bundling: {
          nodeModules: ['@aws-sdk/client-cognito-identity-provider'],
        },
        vpc,
        securityGroups,
      }
    );
    updateUserGroupsFunction.addToRolePolicy(cognitoAdminPolicy);

    const resetMfaFunction = new NodejsFunction(this, 'ResetMfa', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/admin/resetMfa.ts',
      timeout: Duration.minutes(1),
      environment: commonEnv,
      bundling: {
        nodeModules: ['@aws-sdk/client-cognito-identity-provider'],
      },
      vpc,
      securityGroups,
    });
    resetMfaFunction.addToRolePolicy(cognitoAdminPolicy);

    const getPasswordPolicyFunction = new NodejsFunction(
      this,
      'GetPasswordPolicy',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/admin/getPasswordPolicy.ts',
        timeout: Duration.minutes(1),
        environment: commonEnv,
        bundling: {
          nodeModules: ['@aws-sdk/client-cognito-identity-provider'],
        },
        vpc,
        securityGroups,
      }
    );
    getPasswordPolicyFunction.addToRolePolicy(cognitoAdminPolicy);

    const updatePasswordPolicyFunction = new NodejsFunction(
      this,
      'UpdatePasswordPolicy',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/admin/updatePasswordPolicy.ts',
        timeout: Duration.minutes(1),
        environment: commonEnv,
        bundling: {
          nodeModules: ['@aws-sdk/client-cognito-identity-provider'],
        },
        vpc,
        securityGroups,
      }
    );
    updatePasswordPolicyFunction.addToRolePolicy(cognitoAdminPolicy);

    // --- License management Lambda (single router to limit the stack's
    // CloudFormation resource count) ---

    const licenseAdminApiFunction = new NodejsFunction(
      this,
      'LicenseAdminApi',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/admin/licenseAdminApi.ts',
        timeout: Duration.minutes(1),
        environment: {
          LICENSE_TABLE_NAME: props.licenseTable.tableName,
          MODEL_IDS: JSON.stringify(props.modelIds),
        },
        vpc,
        securityGroups,
      }
    );
    props.licenseTable.grantReadWriteData(licenseAdminApiFunction);
    const licenseAdminApiIntegration = new LambdaIntegration(
      licenseAdminApiFunction
    );

    // --- API Gateway Resources ---

    const adminResource = api.root.addResource('admin');

    // /admin/users
    const usersResource = adminResource.addResource('users');

    // GET /admin/users
    usersResource.addMethod(
      'GET',
      new LambdaIntegration(listUsersFunction),
      commonAuthorizerProps
    );

    // POST /admin/users
    usersResource.addMethod(
      'POST',
      new LambdaIntegration(createUserFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}
    const userResource = usersResource.addResource('{username}');

    // DELETE /admin/users/{username}
    userResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteUserFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/disable
    const disableResource = userResource.addResource('disable');

    // POST /admin/users/{username}/disable
    disableResource.addMethod(
      'POST',
      new LambdaIntegration(disableUserFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/enable
    const enableResource = userResource.addResource('enable');

    // POST /admin/users/{username}/enable
    enableResource.addMethod(
      'POST',
      new LambdaIntegration(enableUserFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/reset-mfa
    const resetMfaResource = userResource.addResource('reset-mfa');

    // POST /admin/users/{username}/reset-mfa
    resetMfaResource.addMethod(
      'POST',
      new LambdaIntegration(resetMfaFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/groups
    const userGroupsResource = userResource.addResource('groups');

    // PUT /admin/users/{username}/groups
    userGroupsResource.addMethod(
      'PUT',
      new LambdaIntegration(updateUserGroupsFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/license
    const userLicenseResource = userResource.addResource('license');

    // GET /admin/users/{username}/license
    userLicenseResource.addMethod(
      'GET',
      licenseAdminApiIntegration,
      commonAuthorizerProps
    );

    // PUT /admin/users/{username}/license
    userLicenseResource.addMethod(
      'PUT',
      licenseAdminApiIntegration,
      commonAuthorizerProps
    );

    // /admin/license
    const licenseResource = adminResource.addResource('license');

    // /admin/license/plans
    const licensePlansResource = licenseResource.addResource('plans');

    // GET /admin/license/plans
    licensePlansResource.addMethod(
      'GET',
      licenseAdminApiIntegration,
      commonAuthorizerProps
    );

    // POST /admin/license/plans
    licensePlansResource.addMethod(
      'POST',
      licenseAdminApiIntegration,
      commonAuthorizerProps
    );

    // /admin/license/plans/{planId}
    const licensePlanResource = licensePlansResource.addResource('{planId}');

    // PUT /admin/license/plans/{planId}
    licensePlanResource.addMethod(
      'PUT',
      licenseAdminApiIntegration,
      commonAuthorizerProps
    );

    // DELETE /admin/license/plans/{planId}
    licensePlanResource.addMethod(
      'DELETE',
      licenseAdminApiIntegration,
      commonAuthorizerProps
    );

    // GET /admin/license/priced-models
    licenseResource
      .addResource('priced-models')
      .addMethod('GET', licenseAdminApiIntegration, commonAuthorizerProps);

    // GET /admin/license/usage-summary
    licenseResource
      .addResource('usage-summary')
      .addMethod('GET', licenseAdminApiIntegration, commonAuthorizerProps);

    // /admin/password-policy
    const passwordPolicyResource = adminResource.addResource('password-policy');

    // GET /admin/password-policy
    passwordPolicyResource.addMethod(
      'GET',
      new LambdaIntegration(getPasswordPolicyFunction),
      commonAuthorizerProps
    );

    // PUT /admin/password-policy
    passwordPolicyResource.addMethod(
      'PUT',
      new LambdaIntegration(updatePasswordPolicyFunction),
      commonAuthorizerProps
    );
  }
}
