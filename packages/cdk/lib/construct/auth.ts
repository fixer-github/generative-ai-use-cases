import { Duration, Stack } from 'aws-cdk-lib';
import {
  LambdaVersion,
  StringAttribute,
  UserPool,
  UserPoolClient,
  UserPoolEmail,
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
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS, LAMBDA_RUNTIME_PYTHON } from '../../consts';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { SelfSignUpTenantMapEntry } from 'generative-ai-use-cases';

export interface AuthProps {
  readonly selfSignUpEnabled: boolean;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
  readonly selfSignUpTenantMap?: SelfSignUpTenantMapEntry[] | null;
  readonly samlAuthEnabled: boolean;
  readonly samlDefaultAuthEnabled: boolean;
  // SES Email Configuration (optional - uses Cognito default 50/day limit if not specified)
  readonly sesFromEmail?: string | null;
  readonly sesFromName?: string | null;
  readonly sesReplyTo?: string | null;
  readonly sesRegion?: string | null;
  readonly sesVerifiedDomain?: string | null; // Use domain verification instead of email verification
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly idPool: IdentityPool;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    // Configure email: use SES if sesFromEmail is provided, otherwise use Cognito default (50/day limit)
    const email = props.sesFromEmail
      ? UserPoolEmail.withSES({
          fromEmail: props.sesFromEmail,
          fromName: props.sesFromName ?? undefined,
          replyTo: props.sesReplyTo ?? undefined,
          sesRegion: props.sesRegion ?? undefined,
          sesVerifiedDomain: props.sesVerifiedDomain ?? undefined,
        })
      : undefined; // Use Cognito default email

    const userPool = new UserPool(this, 'UserPool', {
      // If SAML authentication is enabled and default auth is disabled, do not use self-sign-up with UserPool. Be aware of security.
      selfSignUpEnabled:
        props.samlAuthEnabled && !props.samlDefaultAuthEnabled
          ? false
          : props.selfSignUpEnabled,
      signInAliases: {
        username: false,
        email: true,
      },
      email,
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

    if (props.allowedIpV4AddressRanges || props.allowedIpV6AddressRanges) {
      const ipRanges = [
        ...(props.allowedIpV4AddressRanges
          ? props.allowedIpV4AddressRanges
          : []),
        ...(props.allowedIpV6AddressRanges
          ? props.allowedIpV6AddressRanges
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
    if (props.selfSignUpTenantMap && props.selfSignUpTenantMap.length > 0) {
      const checkTenantFunction = new NodejsFunction(this, 'CheckTenant', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/checkTenant.ts',
        timeout: Duration.seconds(30),
        environment: {
          SELF_SIGNUP_TENANT_MAP: JSON.stringify(props.selfSignUpTenantMap),
        },
      });

      userPool.addTrigger(UserPoolOperation.PRE_SIGN_UP, checkTenantFunction);

      const assignTenantFunction = new NodejsFunction(this, 'AssignTenant', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/assignTenant.ts',
        timeout: Duration.seconds(30),
        environment: {
          SELF_SIGNUP_TENANT_MAP: JSON.stringify(props.selfSignUpTenantMap),
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

    // Email customization: Use Custom Email Sender Lambda with SES for HTML emails,
    // or fall back to Custom Message Lambda for Cognito default email
    if (props.sesFromEmail) {
      // Create KMS key for encrypting/decrypting verification codes
      const kmsKey = new kms.Key(this, 'CustomEmailSenderKey', {
        description: 'KMS key for Cognito Custom Email Sender',
        enableKeyRotation: true,
      });

      // Allow Cognito to use the KMS key
      kmsKey.addToResourcePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          principals: [new ServicePrincipal('cognito-idp.amazonaws.com')],
          actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey*'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:SourceAccount': Stack.of(this).account,
            },
          },
        })
      );

      // Custom Email Sender Lambda
      const customEmailSenderFunction = new NodejsFunction(
        this,
        'CustomEmailSender',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry: './lambda/customEmailSender.ts',
          timeout: Duration.seconds(30),
          environment: {
            KMS_KEY_ID: kmsKey.keyId,
            KMS_KEY_ARN: kmsKey.keyArn,
            SES_FROM_EMAIL: props.sesFromEmail,
            SES_FROM_NAME: props.sesFromName ?? 'GaiXer',
            SES_REGION: props.sesRegion ?? Stack.of(this).region,
          },
          bundling: {
            nodeModules: ['@aws-crypto/client-node'],
          },
        }
      );

      // Grant Lambda permissions
      kmsKey.grantDecrypt(customEmailSenderFunction);
      customEmailSenderFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ses:SendEmail', 'ses:SendRawEmail'],
          resources: ['*'],
        })
      );

      // Allow Cognito to invoke the Lambda
      customEmailSenderFunction.addPermission('CognitoInvoke', {
        principal: new ServicePrincipal('cognito-idp.amazonaws.com'),
        sourceArn: userPool.userPoolArn,
      });

      // Configure Custom Email Sender trigger using CfnUserPool
      const cfnUserPool = userPool.node.defaultChild as import('aws-cdk-lib/aws-cognito').CfnUserPool;
      cfnUserPool.lambdaConfig = {
        ...cfnUserPool.lambdaConfig,
        customEmailSender: {
          lambdaArn: customEmailSenderFunction.functionArn,
          lambdaVersion: 'V1_0',
        },
        kmsKeyId: kmsKey.keyArn,
      };
    } else {
      // Fall back to Custom Message Lambda for Cognito default email
      const customMessageFunction = new NodejsFunction(this, 'CustomMessage', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/customMessage.ts',
        timeout: Duration.seconds(5),
      });

      userPool.addTrigger(
        UserPoolOperation.CUSTOM_MESSAGE,
        customMessageFunction
      );
    }

    this.client = client;
    this.userPool = userPool;
    this.idPool = idPool;
  }
}
