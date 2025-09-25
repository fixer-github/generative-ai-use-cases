import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Transcribe, SpeechToSpeech, McpApi } from '../../construct';
import { UseCaseBuilder } from '../../construct/use-case-builder';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { ProcessedStackInput } from '../../stack-input';
import { TenantManager } from '../../construct/tenant-manager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export interface ExtensionStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPoolId: string;
  readonly idPoolId: string;
  readonly apiRestApiId: string;
  readonly apiRestApiRootResourceId: string;
  readonly fileBucketName?: string;
  readonly tenantManagerTableName: string;
  readonly tenantRegistrationLambdaArn: string;
  readonly isSageMakerStudio: boolean;
}

export class ExtensionStack extends Stack {
  public readonly speechToSpeechNamespace: string;
  public readonly speechToSpeechEventApiEndpoint: string;
  public readonly mcpEndpoint: string | null = null;

  constructor(scope: Construct, id: string, props: ExtensionStackProps) {
    super(scope, id, props);

    const params = props.params;

    const userPool = cognito.UserPool.fromUserPoolId(
      this,
      'ImportedUserPool',
      props.userPoolId
    );

    const idPool = IdentityPool.fromIdentityPoolId(
      this,
      'ImportedIdPool',
      props.idPoolId
    );

    const restApi = apigateway.RestApi.fromRestApiId(
      this,
      'ImportedRestApi',
      props.apiRestApiId
    );

    const tenantsTable = dynamodb.Table.fromTableName(
      this,
      'ImportedTenantsTable',
      props.tenantManagerTableName
    );

    const registrationLambda = lambda.Function.fromFunctionArn(
      this,
      'ImportedRegistrationLambda',
      props.tenantRegistrationLambdaArn
    );

    // Note: TenantManager requires concrete classes, not interfaces
    // CDK's fromXXX methods return interfaces, so casting is necessary
    const tenantManager = {
      tenantsTable: tenantsTable as dynamodb.Table,
      registrationLambda: registrationLambda as any,
    } as TenantManager;

    const speechToSpeech = new SpeechToSpeech(this, 'SpeechToSpeech', {
      envSuffix: params.env,
      api: restApi as apigateway.RestApi,
      userPool: userPool as cognito.UserPool,
      speechToSpeechModelIds: params.speechToSpeechModelIds,
      crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
    });

    this.speechToSpeechNamespace = speechToSpeech.namespace;
    this.speechToSpeechEventApiEndpoint = speechToSpeech.eventApiEndpoint;

    if (params.mcpEnabled && props.fileBucketName) {
      const fileBucket = s3.Bucket.fromBucketName(
        this,
        'ImportedFileBucket',
        props.fileBucketName
      );

      const mcpApi = new McpApi(this, 'McpApi', {
        idPool: idPool as IdentityPool,
        isSageMakerStudio: props.isSageMakerStudio,
        fileBucket: fileBucket as s3.Bucket,
      });
      this.mcpEndpoint = mcpApi.endpoint;
    }

    if (params.useCaseBuilderEnabled) {
      new UseCaseBuilder(this, 'UseCaseBuilder', {
        userPool: userPool as cognito.UserPool,
        api: restApi as apigateway.RestApi,
        idPool: idPool as IdentityPool,
        environment: params.env,
        tenantManager: tenantManager,
      });
    }

    new Transcribe(this, 'Transcribe', {
      userPool: userPool as cognito.UserPool,
      idPool: idPool as IdentityPool,
      api: restApi as apigateway.RestApi,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      tenantManager: tenantManager,
      environment: params.env,
    });

    new CfnOutput(this, 'SpeechToSpeechNamespace', {
      value: speechToSpeech.namespace,
      exportName: `${this.stackName}-SpeechToSpeechNamespace`,
    });

    new CfnOutput(this, 'SpeechToSpeechEventApiEndpoint', {
      value: speechToSpeech.eventApiEndpoint,
      exportName: `${this.stackName}-SpeechToSpeechEventApiEndpoint`,
    });

    new CfnOutput(this, 'SpeechToSpeechModelIds', {
      value: JSON.stringify(params.speechToSpeechModelIds),
      exportName: `${this.stackName}-SpeechToSpeechModelIds`,
    });

    new CfnOutput(this, 'McpEnabled', {
      value: params.mcpEnabled.toString(),
      exportName: `${this.stackName}-McpEnabled`,
    });

    new CfnOutput(this, 'McpEndpoint', {
      value: this.mcpEndpoint ?? '',
      exportName: `${this.stackName}-McpEndpoint`,
    });

    new CfnOutput(this, 'UseCaseBuilderEnabled', {
      value: params.useCaseBuilderEnabled.toString(),
      exportName: `${this.stackName}-UseCaseBuilderEnabled`,
    });
  }
}
