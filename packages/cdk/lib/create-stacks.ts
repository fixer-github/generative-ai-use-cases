import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { GenerativeAiUseCasesStack } from './stacks/common/generative-ai-use-cases-stack';
import { CloudFrontWafStack } from './stacks/common/cloud-front-waf-stack';
import { DashboardStack } from './stacks/common/dashboard-stack';
import { AgentStack } from './stacks/common/agent-stack';
import { RagKnowledgeBaseStack } from './stacks/common/rag-knowledge-base-stack';
import { UnifiedOpenSearchStack } from './stacks/common/unified-opensearch-stack';
import { GuardrailStack } from './stacks/common/guardrail-stack';
import { AuthorizationFunctionsStack } from './stacks/common/authorization-functions-stack';
import { ProcessedStackInput } from './stack-input';
import { VideoTmpBucketStack } from './stacks/common/video-tmp-bucket-stack';
import * as process from 'process';

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
  // Only deploy CloudFrontWafStack if useWebUi is true and IP address range (v4 or v6) or geographic restriction or custom domain or Anti-DDoS protection is defined
  // WAF v2 is only deployable in us-east-1, so the Stack is separated
  const cloudFrontWafStack =
    params.useWebUi &&
    (params.allowedIpV4AddressRanges ||
      params.allowedIpV6AddressRanges ||
      params.allowedCountryCodes ||
      params.hostName ||
      params.antiDDoSProtection)
      ? new CloudFrontWafStack(app, `CloudFrontWafStack${params.env}`, {
          env: {
            account: params.account,
            region: 'us-east-1',
          },
          params: params,
          crossRegionReferences: true,
        })
      : null;

  // Unified OpenSearch Stack (for both Bedrock Knowledge Base and tenant assistant RAG)
  // This replaces both OpenSearch Serverless and tenant VPC-based OpenSearch
  // Always create when:
  // 1. RAG Knowledge Base is enabled and no existing KB ID is provided, OR
  // 2. Assistant RAG functionality is needed (tenant OpenSearch stacks have been removed)
  // Note: If ragKnowledgeBaseId is provided, an external OpenSearch is used for KB,
  //       but we still need a domain for assistant RAG unless explicitly disabled
  const needsUnifiedOpenSearch = !params.ragKnowledgeBaseId;
  const unifiedOpenSearchStack = needsUnifiedOpenSearch
    ? new UnifiedOpenSearchStack(app, `UnifiedOpenSearchStack${params.env}`, {
        env: {
          account: params.account,
          region: params.modelRegion,
        },
        params: params,
        crossRegionReferences: true,
      })
    : null;

  // RAG Knowledge Base (depends on UnifiedOpenSearchStack)
  const ragKnowledgeBaseStack =
    params.ragKnowledgeBaseEnabled &&
    !params.ragKnowledgeBaseId &&
    unifiedOpenSearchStack
      ? new RagKnowledgeBaseStack(app, `RagKnowledgeBaseStack${params.env}`, {
          env: {
            account: params.account,
            region: params.modelRegion,
          },
          params: params,
          crossRegionReferences: true,
          // Pass unified OpenSearch configuration
          unifiedOpenSearchDomainArn: unifiedOpenSearchStack.domainArn,
          unifiedOpenSearchDomainEndpoint:
            unifiedOpenSearchStack.domainEndpoint,
          knowledgeBaseRoleArn:
            unifiedOpenSearchStack.knowledgeBaseRole.roleArn,
        })
      : null;

  // Add dependency if both stacks exist
  if (ragKnowledgeBaseStack && unifiedOpenSearchStack) {
    ragKnowledgeBaseStack.addDependency(unifiedOpenSearchStack);
  }

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

  // GenU Stack
  const isSageMakerStudio = 'SAGEMAKER_APP_TYPE_LOWERCASE' in process.env;
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
      // Unified OpenSearch (for assistant RAG)
      unifiedOpenSearchEndpoint: unifiedOpenSearchStack?.domainEndpoint,
      unifiedOpenSearchDomainArn: unifiedOpenSearchStack?.domainArn,
      unifiedOpenSearchIndexName: unifiedOpenSearchStack?.assistantIndexName,
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
    }
  );

  cdk.Aspects.of(generativeAiUseCasesStack).add(
    new DeletionPolicySetter(cdk.RemovalPolicy.DESTROY)
  );

  // Authorization Functions Stack (shared Lambda functions and EventBridge for all tenants)
  const authorizationFunctionsStack = new AuthorizationFunctionsStack(
    app,
    `AuthorizationFunctionsStack${params.env}`,
    {
      env: {
        account: params.account,
        region: params.region,
      },
      environment: params.env,
      tenantsTableName:
        generativeAiUseCasesStack.tenantManager.tenantsTable.tableName,
      // Pass backgroundJobRole for grantPermission Lambda to use shared role
      // This allows grantPermission to AssumeRole to TenantRole-* for cross-tenant access
      backgroundJobRole: generativeAiUseCasesStack.backgroundJobRole,
    }
  );
  authorizationFunctionsStack.addDependency(generativeAiUseCasesStack);

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
    unifiedOpenSearchStack,
    ragKnowledgeBaseStack,
    agentStack,
    guardrail,
    generativeAiUseCasesStack,
    authorizationFunctionsStack,
    dashboardStack,
  };
};
