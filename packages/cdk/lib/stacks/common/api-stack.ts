import { Stack, StackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { Api, LitellmProxyServer, TenantManager } from '../../construct';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ProcessedStackInput } from '../../stack-input';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { Agent } from 'generative-ai-use-cases';
import { Table } from 'aws-cdk-lib/aws-dynamodb';

interface ApiStackProps extends StackProps {
  params: ProcessedStackInput;
  videoBucketRegionMap: Record<string, string>;
  knowledgeBaseId?: string;

  // From other stacks
  userPool: UserPool;
  idPool: IdentityPool;
  agents?: Agent[];
  guardrailIdentify?: string;
  guardrailVersion?: string;
  userPoolClient: UserPoolClient;
  litellmEndpoint?: string;
  litellmProxy?: LitellmProxyServer;
  table: Table;
  statsTable: Table;
  tenantManager?: TenantManager;
}

class ApiStack extends Stack {
  readonly restApi: RestApi;

  readonly predictStreamFunction: NodejsFunction;
  readonly invokeFlowFunction: NodejsFunction;
  readonly optimizePromptFunction: NodejsFunction;
  readonly getFileDownloadSignedUrlFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      params,
      videoBucketRegionMap,
      knowledgeBaseId,
      userPool,
      idPool,
      agents,
      guardrailIdentify,
      guardrailVersion: guardRailVersion,
      userPoolClient,
      litellmEndpoint,
      litellmProxy,
      table,
      statsTable,
      tenantManager,
    } = props;

    const apiConstruct = new Api(scope, 'Api', {
      modelRegion: params.modelRegion,
      modelIds: params.modelIds,
      imageGenerationModelIds: params.imageGenerationModelIds,
      videoGenerationModelIds: params.videoGenerationModelIds,
      videoBucketRegionMap: videoBucketRegionMap,
      endpointNames: params.endpointNames,
      customAgents: params.agents,
      queryDecompositionEnabled: params.queryDecompositionEnabled,
      rerankingModelId: params.rerankingModelId,
      crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      selfSignUpTenantMap: params.selfSignUpTenantMap,
      environment: params.env,

      knowledgeBaseId: knowledgeBaseId,
      userPool: userPool,
      idPool: idPool,
      agents: agents,
      guardrailIdentify: guardrailIdentify,
      guardrailVersion: guardRailVersion,
      userPoolClient: userPoolClient,
      litellmEndpoint: litellmEndpoint,
      litellmProxy: litellmProxy,
      table: table,
      statsTable: statsTable,
      tenantManager: tenantManager,
    });

    this.restApi = apiConstruct.restApi;
    this.predictStreamFunction = apiConstruct.predictStreamFunction;
    this.invokeFlowFunction = apiConstruct.invokeFlowFunction;
    this.optimizePromptFunction = apiConstruct.optimizePromptFunction;
    this.getFileDownloadSignedUrlFunction =
      apiConstruct.getFileDownloadSignedUrlFunction;
  }
}

export default ApiStack;
