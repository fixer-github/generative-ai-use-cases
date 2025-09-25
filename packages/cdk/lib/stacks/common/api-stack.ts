import { Stack, StackProps, CfnOutput, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Api, LitellmProxyServer } from '../../construct';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { ProcessedStackInput } from '../../stack-input';
import { Agent, ModelConfiguration } from 'generative-ai-use-cases';
import { TenantManager } from '../../construct/tenant-manager';

export interface ApiStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly idPoolId: string;
  readonly tableName: string;
  readonly statsTableName: string;
  readonly tenantManagerTableName: string;
  readonly tenantRegistrationLambdaArn: string;
  readonly knowledgeBaseId?: string;
  readonly agents?: Agent[];
  readonly guardrailIdentifier?: string;
  readonly guardrailVersion?: string;
  readonly videoBucketRegionMap: Record<string, string>;
  readonly isSageMakerStudio: boolean;
}

export class ApiStack extends Stack {
  public readonly restApiUrl: string;
  public readonly restApiId: string;
  public readonly restApiRootResourceId: string;
  public readonly restApiArn: string;
  public readonly predictStreamFunctionArn: string;
  public readonly invokeFlowFunctionArn: string;
  public readonly optimizePromptFunctionArn: string;
  public readonly fileBucketName: string;
  public readonly modelRegion: string;
  public readonly modelIds: ModelConfiguration[];
  public readonly imageGenerationModelIds: ModelConfiguration[];
  public readonly videoGenerationModelIds: ModelConfiguration[];
  public readonly endpointNames: string[];
  public readonly agentNames: string[];
  public readonly litellmEndpoint: string | null = null;
  public readonly getFileDownloadSignedUrlFunctionArn?: string;
  public readonly getFileDownloadSignedUrlFunctionRoleArn?: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const params = props.params;

    const userPool = cognito.UserPool.fromUserPoolId(
      this,
      'ImportedUserPool',
      props.userPoolId
    );

    const userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
      this,
      'ImportedUserPoolClient',
      props.userPoolClientId
    );

    const idPool = IdentityPool.fromIdentityPoolId(
      this,
      'ImportedIdPool',
      props.idPoolId
    );

    const table = dynamodb.Table.fromTableName(
      this,
      'ImportedTable',
      props.tableName
    );

    const statsTable = dynamodb.Table.fromTableName(
      this,
      'ImportedStatsTable',
      props.statsTableName
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

    let litellmProxy: LitellmProxyServer | null = null;
    if (params.litellmProxyEnabled) {
      litellmProxy = new LitellmProxyServer(this, 'LitellmProxyServer', {
        idPool: idPool as IdentityPool,
        isSageMakerStudio: props.isSageMakerStudio,
        modelRegion: params.modelRegion,
        crossAccountBedrockRoleArn:
          params.crossAccountBedrockRoleArn || undefined,
      });
      this.litellmEndpoint = litellmProxy.endpoint;
    }

    const api = new Api(this, 'API', {
      modelRegion: params.modelRegion,
      modelIds: params.modelIds,
      imageGenerationModelIds: params.imageGenerationModelIds,
      videoGenerationModelIds: params.videoGenerationModelIds,
      videoBucketRegionMap: props.videoBucketRegionMap,
      endpointNames: params.endpointNames,
      customAgents: params.agents,
      queryDecompositionEnabled: params.queryDecompositionEnabled,
      rerankingModelId: params.rerankingModelId,
      crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      litellmEndpoint: this.litellmEndpoint,
      litellmProxy: litellmProxy,
      selfSignUpTenantMap: params.selfSignUpTenantMap,
      userPool: userPool as cognito.UserPool,
      idPool: idPool as IdentityPool,
      userPoolClient: userPoolClient as cognito.UserPoolClient,
      table: table as dynamodb.Table,
      statsTable: statsTable as dynamodb.Table,
      knowledgeBaseId: params.ragKnowledgeBaseId || props.knowledgeBaseId,
      agents: props.agents,
      guardrailIdentify: props.guardrailIdentifier,
      guardrailVersion: props.guardrailVersion,
      environment: params.env,
      tenantManager: tenantManager,
      openai: params.openai,
    });

    this.restApiUrl = api.restApi.url;
    this.restApiId = api.restApi.restApiId;
    this.restApiRootResourceId = api.restApi.restApiRootResourceId;
    this.restApiArn = api.restApi.deploymentStage.stageArn;
    this.predictStreamFunctionArn = api.predictStreamFunction.functionArn;
    this.invokeFlowFunctionArn = api.invokeFlowFunction.functionArn;
    this.optimizePromptFunctionArn = api.optimizePromptFunction.functionArn;
    this.fileBucketName = api.fileBucket.bucketName;
    this.modelRegion = api.modelRegion;
    this.modelIds = api.modelIds;
    this.imageGenerationModelIds = api.imageGenerationModelIds;
    this.videoGenerationModelIds = api.videoGenerationModelIds;
    this.endpointNames = api.endpointNames;
    this.agentNames = api.agentNames;
    this.getFileDownloadSignedUrlFunctionArn =
      api.getFileDownloadSignedUrlFunction?.functionArn;
    this.getFileDownloadSignedUrlFunctionRoleArn =
      api.getFileDownloadSignedUrlFunction?.role?.roleArn;

    new CfnOutput(this, 'ApiEndpoint', {
      value: api.restApi.url,
      exportName: `${this.stackName}-ApiEndpoint`,
    });

    new CfnOutput(this, 'RestApiId', {
      value: api.restApi.restApiId,
      exportName: `${this.stackName}-RestApiId`,
    });

    new CfnOutput(this, 'RestApiRootResourceId', {
      value: api.restApi.restApiRootResourceId,
      exportName: `${this.stackName}-RestApiRootResourceId`,
    });

    new CfnOutput(this, 'RestApiArn', {
      value: this.restApiArn,
      exportName: `${this.stackName}-RestApiArn`,
    });

    new CfnOutput(this, 'PredictStreamFunctionArn', {
      value: api.predictStreamFunction.functionArn,
      exportName: `${this.stackName}-PredictStreamFunctionArn`,
    });

    new CfnOutput(this, 'OptimizePromptFunctionArn', {
      value: api.optimizePromptFunction.functionArn,
      exportName: `${this.stackName}-OptimizePromptFunctionArn`,
    });

    new CfnOutput(this, 'InvokeFlowFunctionArn', {
      value: api.invokeFlowFunction.functionArn,
      exportName: `${this.stackName}-InvokeFlowFunctionArn`,
    });

    new CfnOutput(this, 'FileBucketName', {
      value: api.fileBucket.bucketName,
      exportName: `${this.stackName}-FileBucketName`,
    });

    new CfnOutput(this, 'ModelRegion', {
      value: api.modelRegion,
      exportName: `${this.stackName}-ModelRegion`,
    });

    new CfnOutput(this, 'LitellmProxyEndpoint', {
      value: this.litellmEndpoint ?? '',
      exportName: `${this.stackName}-LitellmProxyEndpoint`,
    });
  }
}
