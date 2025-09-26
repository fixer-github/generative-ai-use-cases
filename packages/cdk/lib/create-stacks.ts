import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { GenerativeAiUseCasesStack } from './stacks/common/generative-ai-use-cases-stack';
import { CloudFrontWafStack } from './stacks/common/cloud-front-waf-stack';
import { DashboardStack } from './stacks/common/dashboard-stack';
import { AgentStack } from './stacks/common/agent-stack';
import { RagKnowledgeBaseStack } from './stacks/common/rag-knowledge-base-stack';
import { GuardrailStack } from './stacks/common/guardrail-stack';
import { ProcessedStackInput } from './stack-input';
import { VideoTmpBucketStack } from './stacks/common/video-tmp-bucket-stack';
import process from 'node:process';
import AuthStack from './stacks/common/auth-stack';
import ApiStack from './stacks/common/api-stack';
import LitellmProxyServerStack from './stacks/common/litellm-proxy-server-stack';
import StorageStack from './stacks/common/storage-stack';
import DatabaseStack from './stacks/common/database-stack';
import TenantManagerStack from './stacks/common/tenant-manager-stack';
import WebStack from './stacks/common/web-stack';
import SpeechToSpeechStack from './stacks/common/speech-to-speech-stack';
import McpStack from './stacks/common/mcp-stack';
import RagStack from './stacks/common/rag-stack';

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

  const agentNames = ['']; // TODO: implement

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

  // GenU Stack
  const isSageMakerStudio = 'SAGEMAKER_APP_TYPE_LOWERCASE' in process.env;

  const authStack = new AuthStack(app, `AuthStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
  });

  const tenantManagerStack = new TenantManagerStack(
    app,
    `TenantManagerStack${params.env}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      params: params,
    }
  );

  const storageStack = new StorageStack(app, `StorageStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params,
  });

  const databaseStack = new DatabaseStack(app, `DatabaseStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params,
  });

  const litellmProxyServerStack = params.litellmProxyEnabled
    ? new LitellmProxyServerStack(app, `LitellmProxyServerStack${params.env}`, {
        env: {
          account: params.account,
          region: params.region,
        },
        params,
        idPool: authStack.idPool,
        isSageMakerStudio: isSageMakerStudio,
      })
    : null;

  const apiStack = new ApiStack(app, `ApiStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,

    knowledgeBaseId:
      params.ragKnowledgeBaseId || ragKnowledgeBaseStack?.knowledgeBaseId,

    videoBucketRegionMap: videoBucketRegionMap,

    userPool: authStack.userPool,
    idPool: authStack.idPool,
    agents: agentStack?.agents,
    guardrailIdentify: guardrail?.guardrailIdentifier,
    guardrailVersion: 'DRAFT',
    userPoolClient: authStack.client,
    litellmEndpoint: litellmProxyServerStack?.endpoint,
    litellmProxy: litellmProxyServerStack?.litellmProxy,
    table: databaseStack.database.table,
    statsTable: databaseStack.database.statsTable,
    tenantManager: tenantManagerStack.tenantManager,
  });

  const speechToSpeechStack = new SpeechToSpeechStack(
    app,
    `SpeechToSpeechStack${params.env}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      params: params,
      userPool: authStack.userPool,
      restApi: apiStack.restApi,
    }
  );

  const mcpStack = params.mcpEnabled
    ? new McpStack(app, `McpStack${params.env}`, {
        env: {
          account: params.account,
          region: params.region,
        },
        idPool: authStack.idPool,
        isSageMakerStudio: isSageMakerStudio,
        fileBucket: storageStack.fileBucket,
      })
    : null;

  const webStack = new WebStack(app, `WebStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
    userPool: authStack.userPool,
    client: authStack.client,
    idPool: authStack.idPool,
    restApi: apiStack.restApi,
    predictStreamFunction: apiStack.predictStreamFunction,
    invokeFlowFunction: apiStack.invokeFlowFunction,
    optimizePromptFunction: apiStack.optimizePromptFunction,
    webAclId: cloudFrontWafStack?.webAclArn,
    agentNames: agentNames,
    speechToSpeech: speechToSpeechStack.speechToSpeech,
    mcpEndpoint: mcpStack?.endpoint,
    cert: cloudFrontWafStack?.cert,
  });

  const ragStack = params.ragEnabled
    ? new RagStack(app, `RagStack${params.env}`, {
        env: {
          account: params.account,
          region: params.region,
        },
        params: params,
        userPool: authStack.userPool,
        restApi: apiStack.restApi,
        getFileDownloadSignedUrlFunction:
          apiStack.getFileDownloadSignedUrlFunction,
      })
    : null;

  const generativeAiUseCasesStack = new GenerativeAiUseCasesStack(
    app,
    `GenerativeAiUseCasesStack${params.env}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      description: params.anonymousUsageTracking
        ? 'Generative AI Use Cases (uksb-1tupboc48)'
        : undefined,
      params: params,
      crossRegionReferences: true,
      // RAG Knowledge Base
      knowledgeBaseId: ragKnowledgeBaseStack?.knowledgeBaseId,
      knowledgeBaseDataSourceBucketName:
        ragKnowledgeBaseStack?.dataSourceBucketName,
      // Agent
      agents: agentStack?.agents,
      // Video Generation
      videoBucketRegionMap,
      // Guardrail
      guardrailIdentifier: guardrail?.guardrailIdentifier,
      guardrailVersion: 'DRAFT',
      // WAF
      webAclId: cloudFrontWafStack?.webAclArn,
      // Custom Domain
      cert: cloudFrontWafStack?.cert,
      // Image build environment
      isSageMakerStudio,

      // AuthStack
      userPool: authStack.userPool,
      client: authStack.client,
      idPool: authStack.idPool,

      // ApiStack
      agentNames: agentNames,
      endpointNames: params.endpointNames,

      imageGenerationModelIds: params.imageGenerationModelIds,
      videoGenerationModelIds: params.videoGenerationModelIds,
      modelIds: params.modelIds,
      modelRegion: params.modelRegion,
    }
  );

  cdk.Aspects.of(generativeAiUseCasesStack).add(
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
          userPool: generativeAiUseCasesStack.userPool,
          userPoolClient: generativeAiUseCasesStack.userPoolClient,
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
    authStack,
    tenantManagerStack,
    storageStack,
    databaseStack,
    litellmProxyServerStack,
    apiStack,
    speechToSpeechStack,
    mcpApiStack: mcpStack,
    webStack,
    ragStack,
    generativeAiUseCasesStack,
    dashboardStack,
  };
};
