import { Duration, Stack, CfnJson } from 'aws-cdk-lib';
import {
  LambdaVersion,
  StringAttribute,
  UserPool,
  UserPoolClient,
  UserPoolOperation,
  CfnIdentityPoolRoleAttachment,
} from 'aws-cdk-lib/aws-cognito';
import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from 'aws-cdk-lib/aws-cognito-identitypool';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS, LAMBDA_RUNTIME_PYTHON } from '../../consts';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';

export interface AuthProps {
  readonly selfSignUpEnabled: boolean;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
  readonly allowedSignUpEmailDomains?: string[] | null;
  readonly allowedSignUpEmails?: string[] | null;
  readonly samlAuthEnabled: boolean;
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly idPool: IdentityPool;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    const userPool = new UserPool(this, 'UserPool', {
      // If SAML authentication is enabled, do not use self-sign-up with UserPool. Be aware of security.
      selfSignUpEnabled: props.samlAuthEnabled
        ? false
        : props.selfSignUpEnabled,
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
      },
    });

    const client = userPool.addClient('client', {
      idTokenValidity: Duration.days(1),
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
    });

    // Configure Role Mapping for Principal Tags
    // Use CfnJson to handle dynamic provider URL as object key
    const providerUrl = `cognito-idp.${Stack.of(this).region}.amazonaws.com/${userPool.userPoolId}:${client.userPoolClientId}`;
    
    // Create role mappings using CfnJson to handle dynamic keys
    const roleMappings = new CfnJson(this, 'RoleMappings', {
      value: {
        [providerUrl]: {
          type: 'Rules',
          ambiguousRoleResolution: 'AuthenticatedRole',
          identityProvider: providerUrl,
          rulesConfiguration: {
            rules: [
              {
                claim: 'custom:tenant_id',
                matchType: 'Contains',
                value: 'tenant',
                roleArn: idPool.authenticatedRole.roleArn,
              },
              {
                claim: 'custom:tenant_id',
                matchType: 'Equals',
                value: 'default',
                roleArn: idPool.authenticatedRole.roleArn,
              },
            ],
          },
        },
      },
    });
    
    new CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: idPool.identityPoolId,
      roles: {
        authenticated: idPool.authenticatedRole.roleArn,
        unauthenticated: idPool.unauthenticatedRole?.roleArn,
      },
      roleMappings: roleMappings,
    });

    // Configure Principal Tag mapping from JWT claims to IAM session tags
    // This enables ABAC with ${aws:PrincipalTag/TenantID} in IAM policies
    // The custom:tenant_id claim from JWT will be mapped to TenantID Principal Tag

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

    // Multi-tenant policy using Principal Tags for tenant isolation
    idPool.authenticatedRole.attachInlinePolicy(
      new Policy(this, 'MultiTenantPolicy', {
        statements: [
          // DynamoDB access with tenant isolation
          new PolicyStatement({
            sid: 'DynamoDBTenantAccess',
            effect: Effect.ALLOW,
            actions: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:DeleteItem',
              'dynamodb:Query',
              'dynamodb:Scan',
              'dynamodb:BatchGetItem',
              'dynamodb:BatchWriteItem',
              'dynamodb:DescribeTable',
              'dynamodb:DescribeTimeToLive',
            ],
            resources: [
              `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/*-tenant-\${aws:PrincipalTag/TenantID}`,
              `arn:aws:dynamodb:${Stack.of(this).region}:${Stack.of(this).account}:table/*-tenant-\${aws:PrincipalTag/TenantID}/index/*`,
            ],
          }),
          // S3 access with tenant isolation
          new PolicyStatement({
            sid: 'S3TenantAccess',
            effect: Effect.ALLOW,
            actions: [
              's3:GetObject',
              's3:PutObject',
              's3:DeleteObject',
              's3:ListBucket',
            ],
            resources: [
              `arn:aws:s3:::${Stack.of(this).stackName}-*-tenant-\${aws:PrincipalTag/TenantID}`,
              `arn:aws:s3:::${Stack.of(this).stackName}-*-tenant-\${aws:PrincipalTag/TenantID}/*`,
            ],
          }),
          // CloudWatch Logs access
          new PolicyStatement({
            sid: 'CloudWatchLogsAccess',
            effect: Effect.ALLOW,
            actions: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
            ],
            resources: [
              `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/lambda/*`,
            ],
          }),
        ],
      })
    );

    // Lambda
    if (props.allowedSignUpEmailDomains || props.allowedSignUpEmails) {
      const checkEmailDomainFunction = new NodejsFunction(
        this,
        'CheckEmailDomain',
        {
          runtime: LAMBDA_RUNTIME_NODEJS,
          entry: './lambda/checkEmailDomain.ts',
          timeout: Duration.minutes(15),
          environment: {
            ALLOWED_SIGN_UP_EMAIL_DOMAINS_STR: JSON.stringify(
              props.allowedSignUpEmailDomains || []
            ),
            ALLOWED_SIGN_UP_EMAILS_STR: JSON.stringify(
              props.allowedSignUpEmails || []
            ),
          },
        }
      );

      userPool.addTrigger(
        UserPoolOperation.PRE_SIGN_UP,
        checkEmailDomainFunction
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

    this.client = client;
    this.userPool = userPool;
    this.idPool = idPool;
  }
}
