import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { CloudFrontWafStack } from './stacks/common/cloud-front-waf-stack';
import { DashboardStack } from './stacks/common/dashboard-stack';
import { AgentStack } from './stacks/common/agent-stack';
import { RagKnowledgeBaseStack } from './stacks/common/rag-knowledge-base-stack';
import { GuardrailStack } from './stacks/common/guardrail-stack';
import { ProcessedStackInput } from './stack-input';
import { VideoTmpBucketStack } from './stacks/common/video-tmp-bucket-stack';
import { AuthStack } from './stacks/common/auth-stack';
import { DatabaseStack } from './stacks/common/database-stack';
import { ApiStack } from './stacks/common/api-stack';
import { WebStack } from './stacks/common/web-stack';
import { RagStack } from './stacks/common/rag-stack';
import { ExtensionStack } from './stacks/common/extension-stack';
import { WafAssociationStack } from './stacks/common/waf-association-stack';

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

  // Core Stacks
  const isSageMakerStudio = 'SAGEMAKER_APP_TYPE_LOWERCASE' in process.env;

  // 1. Auth Stack
  const authStack = new AuthStack(app, `AuthStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
    crossRegionReferences: true,
  });

  // 2. Database Stack
  const databaseStack = new DatabaseStack(app, `DatabaseStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
    crossRegionReferences: true,
  });

  // 3. API Stack
  const apiStack = new ApiStack(app, `ApiStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
    userPoolId: authStack.userPool.userPoolId,
    userPoolClientId: authStack.userPoolClient.userPoolClientId,
    idPoolId: authStack.idPool.identityPoolId,
    tableName: databaseStack.table.tableName,
    statsTableName: databaseStack.statsTable.tableName,
    tenantManagerTableName: databaseStack.tenantManager.tenantsTable.tableName,
    tenantRegistrationLambdaArn: databaseStack.tenantManager.registrationLambda.functionArn,
    knowledgeBaseId: ragKnowledgeBaseStack?.knowledgeBaseId,
    agents: agentStack?.agents,
    guardrailIdentifier: guardrail?.guardrailIdentifier,
    guardrailVersion: 'DRAFT',
    videoBucketRegionMap,
    isSageMakerStudio,
    crossRegionReferences: true,
  });

  // 4. WAF Association Stack (optional)
  const wafAssociationStack = (
    params.allowedIpV4AddressRanges ||
    params.allowedIpV6AddressRanges ||
    params.allowedCountryCodes
  )
    ? new WafAssociationStack(app, `WafAssociationStack${params.env}`, {
        env: {
          account: params.account,
          region: params.region,
        },
        params: params,
        apiGatewayArn: apiStack.restApiArn,
        userPoolArn: authStack.userPool.userPoolArn,
        crossRegionReferences: true,
      })
    : null;

  // 5. Extension Stack
  const extensionStack = new ExtensionStack(app, `ExtensionStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
    userPoolId: authStack.userPool.userPoolId,
    idPoolId: authStack.idPool.identityPoolId,
    apiRestApiId: apiStack.restApiId,
    apiRestApiRootResourceId: apiStack.restApiRootResourceId,
    fileBucketName: apiStack.fileBucketName,
    tenantManagerTableName: databaseStack.tenantManager.tenantsTable.tableName,
    tenantRegistrationLambdaArn: databaseStack.tenantManager.registrationLambda.functionArn,
    isSageMakerStudio,
    crossRegionReferences: true,
  });

  // 6. RAG Stack (optional)
  const ragStack = (params.ragEnabled || params.ragKnowledgeBaseEnabled)
    ? new RagStack(app, `RagStack${params.env}`, {
        env: {
          account: params.account,
          region: params.region,
        },
        params: params,
        userPoolId: authStack.userPool.userPoolId,
        apiRestApiId: apiStack.restApiId,
        apiRestApiRootResourceId: apiStack.restApiRootResourceId,
        getFileDownloadSignedUrlFunctionArn: apiStack.getFileDownloadSignedUrlFunctionArn,
        getFileDownloadSignedUrlFunctionRoleArn: apiStack.getFileDownloadSignedUrlFunctionRoleArn,
        knowledgeBaseId: ragKnowledgeBaseStack?.knowledgeBaseId,
        knowledgeBaseDataSourceBucketName: ragKnowledgeBaseStack?.dataSourceBucketName,
        crossRegionReferences: true,
      })
    : null;

  // 7. Web Stack
  const webStack = new WebStack(app, `WebStack${params.env}`, {
    env: {
      account: params.account,
      region: params.region,
    },
    params: params,
    userPoolId: authStack.userPool.userPoolId,
    userPoolClientId: authStack.userPoolClient.userPoolClientId,
    idPoolId: authStack.idPool.identityPoolId,
    apiEndpointUrl: apiStack.restApiUrl,
    predictStreamFunctionArn: apiStack.predictStreamFunctionArn,
    invokeFlowFunctionArn: apiStack.invokeFlowFunctionArn,
    optimizePromptFunctionArn: apiStack.optimizePromptFunctionArn,
    modelRegion: apiStack.modelRegion,
    modelIds: apiStack.modelIds,
    imageGenerationModelIds: apiStack.imageGenerationModelIds,
    videoGenerationModelIds: apiStack.videoGenerationModelIds,
    endpointNames: apiStack.endpointNames,
    agentNames: apiStack.agentNames,
    speechToSpeechNamespace: extensionStack.speechToSpeechNamespace,
    speechToSpeechEventApiEndpoint: extensionStack.speechToSpeechEventApiEndpoint,
    mcpEndpoint: extensionStack.mcpEndpoint ?? undefined,
    webAclId: cloudFrontWafStack?.webAclArn,
    cert: cloudFrontWafStack?.cert,
    crossRegionReferences: true,
  });

  // Apply deletion policy to all stacks
  cdk.Aspects.of(authStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  cdk.Aspects.of(databaseStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  cdk.Aspects.of(apiStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  cdk.Aspects.of(extensionStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  cdk.Aspects.of(webStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );
  if (ragStack) {
    cdk.Aspects.of(ragStack).add(
      new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
    );
  }

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
          userPool: authStack.userPool,
          userPoolClient: authStack.userPoolClient,
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
    databaseStack,
    apiStack,
    extensionStack,
    wafAssociationStack,
    ragStack,
    webStack,
    dashboardStack,
  };
};
