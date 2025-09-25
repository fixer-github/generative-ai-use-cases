import { Stack, StackProps, CfnOutput, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Api, LitellmProxyServer, McpApi, CommonWebAcl } from '../../construct';
import { TenantManager } from '../../construct';
import { ProcessedStackInput } from '../../stack-input';
import { Agent, ModelConfiguration } from 'generative-ai-use-cases';

export interface ApiStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly idPool: IdentityPool;
  readonly table: Table;
  readonly statsTable: Table;
  readonly tenantManager: TenantManager;
  readonly knowledgeBaseId?: string;
  readonly agents?: Agent[];
  readonly videoBucketRegionMap: Record<string, string>;
  readonly guardrailIdentifier?: string;
  readonly guardrailVersion?: string;
  readonly isSageMakerStudio: boolean;
}

export class ApiStack extends Stack {
  public readonly restApi: RestApi;
  public readonly predictStreamFunction: NodejsFunction;
  public readonly invokeFlowFunction: NodejsFunction;
  public readonly optimizePromptFunction: NodejsFunction;
  public readonly modelRegion: string;
  public readonly modelIds: ModelConfiguration[];
  public readonly imageGenerationModelIds: ModelConfiguration[];
  public readonly videoGenerationModelIds: ModelConfiguration[];
  public readonly endpointNames: string[];
  public readonly agentNames: string[];
  public readonly fileBucket: Bucket;
  public readonly getFileDownloadSignedUrlFunction: IFunction;
  public readonly litellmEndpoint: string | null = null;
  public readonly mcpEndpoint: string | null = null;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const params = props.params;

    let litellmProxy: LitellmProxyServer | null = null;
    if (params.litellmProxyEnabled) {
      litellmProxy = new LitellmProxyServer(this, 'LitellmProxyServer', {
        idPool: props.idPool,
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
      userPool: props.userPool,
      idPool: props.idPool,
      userPoolClient: props.userPoolClient,
      table: props.table,
      statsTable: props.statsTable,
      knowledgeBaseId: params.ragKnowledgeBaseId || props.knowledgeBaseId,
      agents: props.agents,
      guardrailIdentify: props.guardrailIdentifier,
      guardrailVersion: props.guardrailVersion,
      environment: params.env,
      tenantManager: props.tenantManager,
      openai: params.openai,
    });

    if (
      params.allowedIpV4AddressRanges ||
      params.allowedIpV6AddressRanges ||
      params.allowedCountryCodes
    ) {
      const regionalWaf = new CommonWebAcl(this, 'RegionalWaf', {
        scope: 'REGIONAL',
        allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
        allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
        allowedCountryCodes: params.allowedCountryCodes,
      });
      new CfnWebACLAssociation(this, 'ApiWafAssociation', {
        resourceArn: api.restApi.deploymentStage.stageArn,
        webAclArn: regionalWaf.webAclArn,
      });
      new CfnWebACLAssociation(this, 'UserPoolWafAssociation', {
        resourceArn: props.userPool.userPoolArn,
        webAclArn: regionalWaf.webAclArn,
      });
    }

    if (params.mcpEnabled) {
      const mcpApi = new McpApi(this, 'McpApi', {
        idPool: props.idPool,
        isSageMakerStudio: props.isSageMakerStudio,
        fileBucket: api.fileBucket,
      });
      this.mcpEndpoint = mcpApi.endpoint;
    }

    this.restApi = api.restApi;
    this.predictStreamFunction = api.predictStreamFunction;
    this.invokeFlowFunction = api.invokeFlowFunction;
    this.optimizePromptFunction = api.optimizePromptFunction;
    this.modelRegion = api.modelRegion;
    this.modelIds = api.modelIds;
    this.imageGenerationModelIds = api.imageGenerationModelIds;
    this.videoGenerationModelIds = api.videoGenerationModelIds;
    this.endpointNames = api.endpointNames;
    this.agentNames = api.agentNames;
    this.fileBucket = api.fileBucket;
    this.getFileDownloadSignedUrlFunction = api.getFileDownloadSignedUrlFunction;

    new CfnOutput(this, 'ApiEndpoint', {
      value: api.restApi.url,
      exportName: `${this.stackName}-ApiEndpoint`,
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

    new CfnOutput(this, 'ModelRegion', {
      value: api.modelRegion,
      exportName: `${this.stackName}-ModelRegion`,
    });

    new CfnOutput(this, 'ModelIds', {
      value: JSON.stringify(api.modelIds),
      exportName: `${this.stackName}-ModelIds`,
    });

    new CfnOutput(this, 'ImageGenerateModelIds', {
      value: JSON.stringify(api.imageGenerationModelIds),
      exportName: `${this.stackName}-ImageGenerateModelIds`,
    });

    new CfnOutput(this, 'VideoGenerateModelIds', {
      value: JSON.stringify(api.videoGenerationModelIds),
      exportName: `${this.stackName}-VideoGenerateModelIds`,
    });

    new CfnOutput(this, 'EndpointNames', {
      value: JSON.stringify(api.endpointNames),
      exportName: `${this.stackName}-EndpointNames`,
    });

    new CfnOutput(this, 'AgentNames', {
      value: Buffer.from(JSON.stringify(api.agentNames)).toString('base64'),
      exportName: `${this.stackName}-AgentNames`,
    });

    if (this.mcpEndpoint) {
      new CfnOutput(this, 'McpEndpoint', {
        value: this.mcpEndpoint,
        exportName: `${this.stackName}-McpEndpoint`,
      });
    }

    if (this.litellmEndpoint) {
      new CfnOutput(this, 'LitellmProxyEndpoint', {
        value: this.litellmEndpoint,
        exportName: `${this.stackName}-LitellmProxyEndpoint`,
      });
    }
  }
}