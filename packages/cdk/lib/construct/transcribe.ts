import { Duration, RemovalPolicy } from 'aws-cdk-lib';
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
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
} from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { allowS3AccessWithSourceIpCondition } from '../utils/s3-access-policy';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';
import { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';

export interface TranscribeProps {
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly api: RestApi;
  // License (cash-based usage limit)
  readonly licenseTable: ITable;
  readonly sendgridApiKey?: string | null;
  readonly mailFrom?: string | null;
  readonly allowedIpV4AddressRanges?: string[] | null;
  readonly allowedIpV6AddressRanges?: string[] | null;
  readonly vpc?: IVpc;
  readonly securityGroups?: ISecurityGroup[];
}

export class Transcribe extends Construct {
  constructor(scope: Construct, id: string, props: TranscribeProps) {
    super(scope, id);

    const audioBucket = new Bucket(this, 'AudioBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
    audioBucket.addCorsRule({
      allowedOrigins: ['*'],
      allowedMethods: [HttpMethods.PUT],
      allowedHeaders: ['*'],
      exposedHeaders: [],
      maxAge: 3000,
    });

    const transcriptBucket = new Bucket(this, 'TranscriptBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    const getSignedUrlFunction = new NodejsFunction(this, 'GetSignedUrl', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getFileUploadSignedUrl.ts',
      timeout: Duration.minutes(15),
      environment: {
        BUCKET_NAME: audioBucket.bucketName,
      },
      vpc: props.vpc,
      securityGroups: props.securityGroups,
    });
    if (getSignedUrlFunction.role) {
      allowS3AccessWithSourceIpCondition(
        audioBucket.bucketName,
        getSignedUrlFunction.role,
        'write',
        {
          ipv4: props.allowedIpV4AddressRanges,
          ipv6: props.allowedIpV6AddressRanges,
        }
      );
    }

    const startTranscriptionFunction = new NodejsFunction(
      this,
      'StartTranscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/startTranscription.ts',
        timeout: Duration.minutes(15),
        environment: {
          TRANSCRIPT_BUCKET_NAME: transcriptBucket.bucketName,
          // License gate: remaining > 0 check on job start (requirement 20)
          LICENSE_TABLE_NAME: props.licenseTable.tableName,
        },
        initialPolicy: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['transcribe:*'],
            resources: ['*'],
          }),
        ],
        vpc: props.vpc,
        securityGroups: props.securityGroups,
      }
    );
    audioBucket.grantRead(startTranscriptionFunction);
    transcriptBucket.grantWrite(startTranscriptionFunction);
    props.licenseTable.grantReadWriteData(startTranscriptionFunction);

    const getTranscriptionFunction = new NodejsFunction(
      this,
      'GetTranscription',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/getTranscription.ts',
        timeout: Duration.minutes(15),
        environment: {
          // License: charge the measured duration once on completion
          LICENSE_TABLE_NAME: props.licenseTable.tableName,
          SENDGRID_API_KEY: props.sendgridApiKey ?? '',
          MAIL_FROM: props.mailFrom ?? '',
        },
        initialPolicy: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['transcribe:*'],
            resources: ['*'],
          }),
        ],
        vpc: props.vpc,
        securityGroups: props.securityGroups,
      }
    );
    transcriptBucket.grantRead(getTranscriptionFunction);
    props.licenseTable.grantReadWriteData(getTranscriptionFunction);

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
