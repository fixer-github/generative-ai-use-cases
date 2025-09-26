import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import {
  LambdaVersion,
  StringAttribute,
  UserPool,
  UserPoolClient,
  UserPoolOperation,
} from 'aws-cdk-lib/aws-cognito';
import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from 'aws-cdk-lib/aws-cognito-identitypool';
import {
  Effect,
  Policy,
  PolicyStatement,
  Role,
  CfnRole,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS, LAMBDA_RUNTIME_PYTHON } from '../../../consts';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { ProcessedStackInput } from '../../stack-input';

interface AuthStackProps extends StackProps {
  readonly params: ProcessedStackInput;
}

class AuthStack extends Stack {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly idPool: IdentityPool;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { params } = props;

    const userPool = new UserPool(this, 'UserPool', {
      // If SAML authentication is enabled and default auth is disabled, do not use self-sign-up with UserPool. Be aware of security.
      selfSignUpEnabled:
        params.samlAuthEnabled && !params.samlDefaultAuthEnabled
          ? false
          : params.selfSignUpEnabled,
      signInAliases: {
        username: false,
        email: true,
      },
      passwordPolicy: {
        requireUppercase: true,
        requireSymbols: true,
        requireDigits: true,
        minLength: 8,
      },
      customAttributes: {
        tenant_id: new StringAttribute({
          minLen: 1,
          maxLen: 50,
          mutable: true,
        }),
        tenantAdmin: new StringAttribute({
          minLen: 4, // "true" or "false"
          maxLen: 5,
          mutable: true, // Allows updating admin status
        }),
      },
    });

    const client = userPool.addClient('client', {
      idTokenValidity: Duration.days(1),
      refreshTokenValidity: Duration.days(30),
      accessTokenValidity: Duration.hours(1),
      enableTokenRevocation: true,
      authFlows: {
        adminUserPassword: true,
        custom: true,
        userPassword: true,
        userSrp: true,
      },
    });

    const idPool = new IdentityPool(this, 'IdentityPool', {
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({
            userPool,
            userPoolClient: client,
          }),
        ],
      },
      allowUnauthenticatedIdentities: false,
    });

    // Fix the trust relationship for the authenticated role
    // The Identity Pool's default authenticated role needs proper trust policy
    const authenticatedRole = idPool.authenticatedRole as Role;
    const cfnRole = authenticatedRole.node.defaultChild as CfnRole;

    // Update the assume role policy to properly trust cognito-identity.amazonaws.com
    cfnRole.assumeRolePolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Federated: 'cognito-identity.amazonaws.com',
          },
          Action: ['sts:AssumeRoleWithWebIdentity', 'sts:TagSession'],
          Condition: {
            StringEquals: {
              'cognito-identity.amazonaws.com:aud': idPool.identityPoolId,
            },
            'ForAnyValue:StringLike': {
              'cognito-identity.amazonaws.com:amr': 'authenticated',
            },
          },
        },
      ],
    };

    if (params.allowedIpV4AddressRanges || params.allowedIpV6AddressRanges) {
      const ipRanges = [
        ...(params.allowedIpV4AddressRanges
          ? params.allowedIpV4AddressRanges
          : []),
        ...(params.allowedIpV6AddressRanges
          ? params.allowedIpV6AddressRanges
          : []),
      ];

      idPool.authenticatedRole.attachInlinePolicy(
        new Policy(this, 'SourceIpPolicy', {
          statements: [
            new PolicyStatement({
              effect: Effect.DENY,
              resources: ['*'],
              actions: ['*'],
              conditions: {
                NotIpAddress: {
                  'aws:SourceIp': ipRanges,
                },
              },
            }),
          ],
        })
      );
    }

    idPool.authenticatedRole.attachInlinePolicy(
      new Policy(this, 'PollyPolicy', {
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            resources: ['*'],
            actions: ['polly:SynthesizeSpeech'],
          }),
        ],
      })
    );

    // Lambda
    if (params.selfSignUpTenantMap && params.selfSignUpTenantMap.length > 0) {
      const checkTenantFunction = new NodejsFunction(this, 'CheckTenant', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/checkTenant.ts',
        timeout: Duration.seconds(30),
        environment: {
          SELF_SIGNUP_TENANT_MAP: JSON.stringify(params.selfSignUpTenantMap),
        },
      });

      userPool.addTrigger(UserPoolOperation.PRE_SIGN_UP, checkTenantFunction);

      const assignTenantFunction = new NodejsFunction(this, 'AssignTenant', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/assignTenant.ts',
        timeout: Duration.seconds(30),
        environment: {
          SELF_SIGNUP_TENANT_MAP: JSON.stringify(params.selfSignUpTenantMap),
        },
      });

      assignTenantFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['cognito-idp:AdminUpdateUserAttributes'],
          resources: ['*'],
        })
      );
      userPool.addTrigger(
        UserPoolOperation.POST_CONFIRMATION,
        assignTenantFunction
      );
    }

    // Pre Token Generation Lambda for adding custom claims
    const preTokenGenerationFunction = new PythonFunction(
      this,
      'PreTokenGeneration',
      {
        runtime: LAMBDA_RUNTIME_PYTHON,
        entry: './lambda/pre_token_generation',
        timeout: Duration.seconds(5),
      }
    );

    userPool.addTrigger(
      UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenGenerationFunction,
      LambdaVersion.V2_0
    );

    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });

    new CfnOutput(this, 'UserPoolClientId', {
      value: client.userPoolClientId,
    });

    new CfnOutput(this, 'IdPoolId', { value: idPool.identityPoolId });

    this.client = client;
    this.userPool = userPool;
    this.idPool = idPool;
  }
}

export default AuthStack;
