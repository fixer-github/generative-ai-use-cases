import { Duration, Stack } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { Effect, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

export interface TranscribeProps {
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly api: RestApi;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
}

export class Transcribe extends Construct {
  constructor(scope: Construct, id: string, props: TranscribeProps) {
    super(scope, id);

    const DEFAULT_TENANT_ID = 'default';

    const getSignedUrlFunction = new NodejsFunction(this, 'GetSignedUrl', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getFileUploadSignedUrl.ts',
      timeout: Duration.minutes(15),
      environment: {
        DEFAULT_TENANT_ID: DEFAULT_TENANT_ID,
        IDENTITY_POOL_ID: props.idPool.identityPoolId,
        USER_POOL_ID: props.userPool.userPoolId,
        AWS_REGION: Stack.of(this).region,
      },
    });

    const startTranscriptionFunction = new NodejsFunction(
      this,
      'StartTranscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/startTranscription.ts',
        timeout: Duration.minutes(15),
        environment: {
          DEFAULT_TENANT_ID: DEFAULT_TENANT_ID,
          IDENTITY_POOL_ID: props.idPool.identityPoolId,
          USER_POOL_ID: props.userPool.userPoolId,
          AWS_REGION: Stack.of(this).region,
        },
        initialPolicy: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['transcribe:*'],
            resources: ['*'],
          }),
        ],
      }
    );

    const getTranscriptionFunction = new NodejsFunction(
      this,
      'GetTranscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/getTranscription.ts',
        timeout: Duration.minutes(15),
        environment: {
          DEFAULT_TENANT_ID: DEFAULT_TENANT_ID,
          IDENTITY_POOL_ID: props.idPool.identityPoolId,
          USER_POOL_ID: props.userPool.userPoolId,
          AWS_REGION: Stack.of(this).region,
        },
        initialPolicy: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['transcribe:*'],
            resources: ['*'],
          }),
        ],
      }
    );

    // API Gateway
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
    });

    const commonAuthorizerProps = {
      authorizationType: AuthorizationType.COGNITO,
      authorizer,
    };
    const transcribeResource = props.api.root.addResource('transcribe');

    // POST: /transcribe/start
    transcribeResource
      .addResource('start')
      .addMethod(
        'POST',
        new LambdaIntegration(startTranscriptionFunction),
        commonAuthorizerProps
      );

    // POST: /transcribe/url
    transcribeResource
      .addResource('url')
      .addMethod(
        'POST',
        new LambdaIntegration(getSignedUrlFunction),
        commonAuthorizerProps
      );

    // GET: /transcribe/result/{jobName}
    transcribeResource
      .addResource('result')
      .addResource('{jobName}')
      .addMethod(
        'GET',
        new LambdaIntegration(getTranscriptionFunction),
        commonAuthorizerProps
      );

    // add Policy for Amplify User
    // grant access policy transcribe stream and translate
    props.idPool.authenticatedRole.attachInlinePolicy(
      new Policy(this, 'GrantAccessTranscribeStream', {
        statements: [
          new PolicyStatement({
            actions: ['transcribe:StartStreamTranscriptionWebSocket'],
            resources: ['*'],
          }),
        ],
      })
    );
  }
}
