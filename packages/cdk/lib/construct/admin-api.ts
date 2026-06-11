import { Duration } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  LambdaIntegration,
  Resource,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';
import { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';

export interface AdminApiProps {
  readonly userPool: UserPool;
  readonly api: RestApi;
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

    // This construct is instantiated inside AdminNestedStack (a child NestedStack).
    // By default LambdaIntegration grants invoke permission with sourceArn =
    // method.methodArn, which embeds the parent RestApi's deploymentStage. That makes a
    // child(Permission) -> parent(Stage) cross-stack reference and, combined with
    // Deployment -> child and Stage -> Deployment, produces the cycle
    // Deployment -> child NestedStack -> Stage -> Deployment, so synth fails (this
    // supersedes the memo §4.4 claim that NestedStacks can't cycle). Setting
    // scopePermissionToMethod:false makes sourceArn = api.arnForExecuteApi() (`${restApiId}/*`,
    // no Stage reference), removing the child -> Stage edge and breaking the cycle.
    // (Side benefit: one api-scoped permission per Lambda instead of one per method.)
    const adminLambdaIntegration = (fn: IFunction) =>
      new LambdaIntegration(fn, { scopePermissionToMethod: false });

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

    // --- API Gateway Resources ---

    // This construct is instantiated inside AdminNestedStack (a child NestedStack).
    // `api.root.addResource('admin')` would scope the Resource to the stack that holds the
    // RestApi (= parent), so it would not move into the child (memo §4.1 C1). Scoping it to
    // the child construct (`this`) while naming the API Gateway parent via `parent: api.root`
    // places `/admin` and below in the child. defaultCorsPreflightOptions /
    // defaultMethodOptions / Deployment logical-id hashing are inherited from
    // props.parent(=api.root), so the external shape of `/admin/*` (CORS, authorizer, paths)
    // is unchanged.
    const adminResource = new Resource(this, 'admin', {
      parent: api.root,
      pathPart: 'admin',
    });

    // /admin/users
    const usersResource = adminResource.addResource('users');

    // GET /admin/users
    usersResource.addMethod(
      'GET',
      adminLambdaIntegration(listUsersFunction),
      commonAuthorizerProps
    );

    // POST /admin/users
    usersResource.addMethod(
      'POST',
      adminLambdaIntegration(createUserFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}
    const userResource = usersResource.addResource('{username}');

    // DELETE /admin/users/{username}
    userResource.addMethod(
      'DELETE',
      adminLambdaIntegration(deleteUserFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/disable
    const disableResource = userResource.addResource('disable');

    // POST /admin/users/{username}/disable
    disableResource.addMethod(
      'POST',
      adminLambdaIntegration(disableUserFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/enable
    const enableResource = userResource.addResource('enable');

    // POST /admin/users/{username}/enable
    enableResource.addMethod(
      'POST',
      adminLambdaIntegration(enableUserFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/reset-mfa
    const resetMfaResource = userResource.addResource('reset-mfa');

    // POST /admin/users/{username}/reset-mfa
    resetMfaResource.addMethod(
      'POST',
      adminLambdaIntegration(resetMfaFunction),
      commonAuthorizerProps
    );

    // /admin/users/{username}/groups
    const userGroupsResource = userResource.addResource('groups');

    // PUT /admin/users/{username}/groups
    userGroupsResource.addMethod(
      'PUT',
      adminLambdaIntegration(updateUserGroupsFunction),
      commonAuthorizerProps
    );

    // /admin/password-policy
    const passwordPolicyResource = adminResource.addResource('password-policy');

    // GET /admin/password-policy
    passwordPolicyResource.addMethod(
      'GET',
      adminLambdaIntegration(getPasswordPolicyFunction),
      commonAuthorizerProps
    );

    // PUT /admin/password-policy
    passwordPolicyResource.addMethod(
      'PUT',
      adminLambdaIntegration(updatePasswordPolicyFunction),
      commonAuthorizerProps
    );
  }
}
