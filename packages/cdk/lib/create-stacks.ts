import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { CloudFrontWafStack } from './stacks/common/cloud-front-waf-stack';
import { DashboardStack } from './stacks/common/dashboard-stack';
import { AgentStack } from './stacks/common/agent-stack';
import { RagKnowledgeBaseStack } from './stacks/common/rag-knowledge-base-stack';
import { GuardrailStack } from './stacks/common/guardrail-stack';
import { ProcessedStackInput } from './stack-input';
import { VideoTmpBucketStack } from './stacks/common/video-tmp-bucket-stack';
import { AuthenticationStack } from './stacks/common/authentication-stack';
import { DataStack } from './stacks/common/data-stack';
import { ApiStack } from './stacks/common/api-stack';
import { FrontendStack } from './stacks/common/frontend-stack';
import { AIServicesStack } from './stacks/common/ai-services-stack';

class DeletionPolicySetter implements cdk.IAspect {
  constructor(private readonly policy: cdk.RemovalPolicy) {}

  visit(node: IConstruct): void {
    if (node instanceof cdk.CfnResource) {
      node.applyRemovalPolicy(this.policy);
    }
  }
}

export const createStacks = (app: cdk.App, params: ProcessedStackInput) => {
  // CloudFront WAF
  // Only deploy CloudFrontWafStack if IP address range (v4 or v6) or geographic restriction is defined
  // WAF v2 is only deployable in us-east-1, so the Stack is separated
  const cloudFrontWafStack =
    params.allowedIpV4AddressRanges ||
    params.allowedIpV6AddressRanges ||
    params.allowedCountryCodes ||
    params.hostName
      ? new CloudFrontWafStack(app, `CloudFrontWafStack${params.env}`, {
          env: {
            account: params.account,
            region: 'us-east-1',
          },
          params: params,
          crossRegionReferences: true,
        })
      : null;

  // RAG Knowledge Base
  const ragKnowledgeBaseStack =
    params.ragKnowledgeBaseEnabled && !params.ragKnowledgeBaseId
      ? new RagKnowledgeBaseStack(app, `RagKnowledgeBaseStack${params.env}`, {
          env: {
            account: params.account,
            region: params.modelRegion,
          },
          params: params,
          crossRegionReferences: true,
        })
      : null;

  // Agent
  if (params.crossAccountBedrockRoleArn) {
    if (params.agentEnabled || params.searchApiKey) {
      throw new Error(
        'When `crossAccountBedrockRoleArn` is specified, the `agentEnabled` and `searchApiKey` parameters are not supported. Please create agents in the other account and specify them in the `agents` parameter.'
      );
    }
  }
  const agentStack = params.agentEnabled
    ? new AgentStack(app, `WebSearchAgentStack${params.env}`, {
        env: {
          account: params.account,
          region: params.modelRegion,
        },
        params: params,
        crossRegionReferences: true,
      })
    : null;

  // Guardrail
  const guardrail = params.guardrailEnabled
    ? new GuardrailStack(app, `GuardrailStack${params.env}`, {
        env: {
          account: params.account,
          region: params.modelRegion,
        },
        crossRegionReferences: true,
      })
    : null;

  // Create S3 Bucket for each unique region for StartAsyncInvoke in video generation
  // because the S3 Bucket must be in the same region as Bedrock Runtime
  const videoModelRegions = [
    ...new Set(params.videoGenerationModelIds.map((model) => model.region)),
  ];
  const videoBucketRegionMap: Record<string, string> = {};

  for (const region of videoModelRegions) {
    const videoTmpBucketStack = new VideoTmpBucketStack(
      app,
      `VideoTmpBucketStack${params.env}${region}`,
      {
        env: {
          account: params.account,
          region,
        },
        params,
      }
    );

    videoBucketRegionMap[region] = videoTmpBucketStack.bucketName;
  }

  // Authentication Stack
  const authenticationStack = new AuthenticationStack(
    app,
    `AuthenticationStack${params.env}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      params: params,
      crossRegionReferences: true,
    }
  );

  // Data Stack
  const dataStack = new DataStack(app, `DataStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
    crossRegionReferences: true,
  });

  // API Stack
  const isSageMakerStudio = 'SAGEMAKER_APP_TYPE_LOWERCASE' in process.env;
  const apiStack = new ApiStack(app, `ApiStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    description: params.anonymousUsageTracking
      ? 'Generative AI Use Cases API (uksb-1tupboc48)'
      : undefined,
    params: params,
    userPool: authenticationStack.userPool,
    userPoolClient: authenticationStack.userPoolClient,
    idPool: authenticationStack.auth.idPool,
    table: dataStack.table,
    statsTable: dataStack.statsTable,
    tenantManager: dataStack.tenantManager,
    knowledgeBaseId: ragKnowledgeBaseStack?.knowledgeBaseId,
    agents: agentStack?.agents,
    videoBucketRegionMap,
    guardrailIdentifier: guardrail?.guardrailIdentifier,
    guardrailVersion: 'DRAFT',
    isSageMakerStudio,
    crossRegionReferences: true,
  });

  // Frontend Stack
  const frontendStack = new FrontendStack(app, `FrontendStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
    userPoolId: authenticationStack.userPool.userPoolId,
    userPoolClientId: authenticationStack.userPoolClient.userPoolClientId,
    idPoolId: authenticationStack.idPoolId,
    userPool: authenticationStack.userPool,
    idPool: authenticationStack.auth.idPool,
    apiEndpointUrl: apiStack.restApi.url,
    restApi: apiStack.restApi,
    predictStreamFunctionArn: apiStack.predictStreamFunction.functionArn,
    invokeFlowFunctionArn: apiStack.invokeFlowFunction.functionArn,
    optimizePromptFunctionArn: apiStack.optimizePromptFunction.functionArn,
    modelRegion: apiStack.modelRegion,
    modelIds: apiStack.modelIds,
    imageGenerationModelIds: apiStack.imageGenerationModelIds,
    videoGenerationModelIds: apiStack.videoGenerationModelIds,
    endpointNames: apiStack.endpointNames,
    agentNames: apiStack.agentNames,
    webAclId: cloudFrontWafStack?.webAclArn,
    cert: cloudFrontWafStack?.cert,
    mcpEndpoint: apiStack.mcpEndpoint || undefined,
    speechToSpeechNamespace: apiStack.speechToSpeechNamespace,
    speechToSpeechEventApiEndpoint: apiStack.speechToSpeechEventApiEndpoint,
    crossRegionReferences: true,
  });

  // AI Services Stack
  const aiServicesStack = new AIServicesStack(
    app,
    `AIServicesStack${params.env}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      params: params,
      userPool: authenticationStack.userPool,
      idPool: authenticationStack.auth.idPool,
      restApi: apiStack.restApi,
      tenantManager: dataStack.tenantManager,
      knowledgeBaseId: ragKnowledgeBaseStack?.knowledgeBaseId,
      knowledgeBaseDataSourceBucketName:
        ragKnowledgeBaseStack?.dataSourceBucketName,
      getFileDownloadSignedUrlFunction:
        apiStack.getFileDownloadSignedUrlFunction,
      crossRegionReferences: true,
    }
  );

  // Apply deletion policy to all stacks
  cdk.Aspects.of(authenticationStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  cdk.Aspects.of(dataStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  cdk.Aspects.of(apiStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  cdk.Aspects.of(frontendStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  cdk.Aspects.of(aiServicesStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );

  const dashboardStack = params.dashboard
    ? new DashboardStack(
        app,
        `GenerativeAiUseCasesDashboardStack${params.env}`,
        {
          env: {
            account: params.account,
            region: params.modelRegion,
          },
          params: params,
          userPool: authenticationStack.userPool,
          userPoolClient: authenticationStack.userPoolClient,
          appRegion: params.region,
          crossRegionReferences: true,
        }
      )
    : null;

  return {
    cloudFrontWafStack,
    ragKnowledgeBaseStack,
    agentStack,
    guardrail,
    authenticationStack,
    dataStack,
    apiStack,
    frontendStack,
    aiServicesStack,
    dashboardStack,
  };
};
