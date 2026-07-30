import { z } from 'zod';

// Base schema without refine
const baseStackInputSchema = z.object({
  account: z.string().default(process.env.CDK_DEFAULT_ACCOUNT ?? ''),
  region: z.string().default(process.env.CDK_DEFAULT_REGION ?? 'us-east-1'),
  env: z.string().default(''),
  anonymousUsageTracking: z.boolean().default(true),

  // Auth
  selfSignUpEnabled: z.boolean().default(true),
  allowedSignUpEmailDomains: z.array(z.string()).nullish(),
  mfaRequired: z.boolean().default(false),
  samlAuthEnabled: z.boolean().default(false),
  samlCognitoDomainName: z.string().nullish(),
  samlCognitoFederatedIdentityProviderName: z.string().nullish(),
  // Frontend
  hiddenUseCases: z
    .object({
      generate: z.boolean().optional(),
      summarize: z.boolean().optional(),
      writer: z.boolean().optional(),
      translate: z.boolean().optional(),
      webContent: z.boolean().optional(),
      image: z.boolean().optional(),
      video: z.boolean().optional(),
      videoAnalyzer: z.boolean().optional(),
      diagram: z.boolean().optional(),
      meetingMinutes: z.boolean().optional(),
      voiceChat: z.boolean().optional(),
    })
    .default({}),
  // API
  modelRegion: z.string().default('us-east-1'),
  modelIds: z
    .array(
      z.union([
        z.string(),
        z.object({
          modelId: z.string(),
          region: z.string(),
        }),
      ])
    )
    .default([
      'us.anthropic.claude-sonnet-4-20250514-v1:0',
      'us.anthropic.claude-opus-4-20250514-v1:0',
      'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
      'us.anthropic.claude-3-5-haiku-20241022-v1:0',
      'us.amazon.nova-premier-v1:0',
      'us.amazon.nova-pro-v1:0',
      'us.amazon.nova-lite-v1:0',
      'us.amazon.nova-micro-v1:0',
      'us.deepseek.r1-v1:0',
    ]),
  imageGenerationEnabled: z.boolean().default(true),
  imageGenerationModelIds: z
    .array(
      z.union([
        z.string(),
        z.object({
          modelId: z.string(),
          region: z.string(),
        }),
      ])
    )
    .default(['amazon.nova-canvas-v1:0']),
  videoGenerationEnabled: z.boolean().default(true),
  videoGenerationModelIds: z
    .array(
      z.union([
        z.string(),
        z.object({
          modelId: z.string(),
          region: z.string(),
        }),
      ])
    )
    .default(['amazon.nova-reel-v1:0']),
  // SpeechToSpeech
  speechToSpeechEnabled: z.boolean().default(true),
  speechToSpeechModelIds: z
    .array(
      z.union([
        z.string(),
        z.object({
          modelId: z.string(),
          region: z.string(),
        }),
      ])
    )
    .default(['amazon.nova-sonic-v1:0']),
  endpointNames: z
    .array(
      z.union([
        z.string(),
        z.object({
          modelId: z.string(),
          region: z.string(),
        }),
      ])
    )
    .default([]),
  crossAccountBedrockRoleArn: z.string().nullish(),
  // Additional S3 buckets for download access (e.g., external agent buckets like fixer-excel-agent)
  additionalS3Buckets: z.array(z.string()).default([]),
  // RAG
  ragEnabled: z.boolean().default(false),
  kendraIndexLanguage: z.string().default('ja'),
  kendraIndexArn: z.string().nullish(),
  kendraDataSourceBucketName: z.string().nullish(),
  kendraIndexScheduleEnabled: z.boolean().default(false),
  kendraIndexScheduleCreateCron: z
    .object({
      minute: z.string(),
      hour: z.string(),
      month: z.string(),
      weekDay: z.string(),
    })
    .nullish(),
  kendraIndexScheduleDeleteCron: z
    .object({
      minute: z.string(),
      hour: z.string(),
      month: z.string(),
      weekDay: z.string(),
    })
    .nullish(),
  // RAG KB
  ragKnowledgeBaseEnabled: z.boolean().default(false),
  ragKnowledgeBaseId: z.string().nullish(),
  embeddingModelId: z.string().default('amazon.titan-embed-text-v2:0'),
  ragKnowledgeBaseStandbyReplicas: z.boolean().default(false),
  ragKnowledgeBaseAdvancedParsing: z.boolean().default(false),
  ragKnowledgeBaseAdvancedParsingModelId: z
    .string()
    .default('anthropic.claude-3-sonnet-20240229-v1:0'),
  ragKnowledgeBaseBinaryVector: z.boolean().default(false),
  queryDecompositionEnabled: z.boolean().default(false),
  rerankingModelId: z.string().nullish(),
  // Agent
  agentEnabled: z.boolean().default(false),
  searchAgentEnabled: z.boolean().default(false),
  searchApiKey: z.string().nullish(),
  searchEngine: z.enum(['Brave', 'Tavily']).default('Brave'),
  // SSM SecureString parameter name (e.g. "/genu/search-api-key"). Preferred over searchApiKey
  // when set: the Lambda fetches the value at runtime instead of receiving it as an env var.
  searchApiKeySsmParameterName: z.string().nullish(),
  agents: z
    .array(
      z.object({
        displayName: z.string(),
        agentId: z.string(),
        aliasId: z.string(),
        description: z.string().default(''),
      })
    )
    .default([]),
  inlineAgents: z.boolean().default(false),
  // Agent Core Runtime
  agentBuilderEnabled: z.boolean().default(false),
  createGenericAgentCoreRuntime: z.boolean().default(false),
  agentCoreRegion: z.string().nullish(),
  agentCoreGatewayArns: z.array(z.string()).nullish(),
  agentCoreExternalRuntimes: z
    .array(
      z.object({
        name: z.string(),
        displayName: z.string().optional(),
        arn: z.string(),
        description: z.string().default(''),
        apps: z
          .array(
            z.object({
              id: z.string().regex(/^[a-z0-9-]+$/, {
                message:
                  'App id must contain only lowercase alphanumeric characters and hyphens',
              }),
              displayName: z.string(),
              url: z.string().url(),
            })
          )
          .optional(),
      })
    )
    .default([]),
  // Email notification (SendGrid) shared across the app (scheduler + auth)
  // The API key and the authenticated sender address are configured directly
  // in cdk.json (mirrors searchApiKey). When either is unset, or in
  // closed-network mode, SendGrid email is disabled (the scheduler still runs
  // tasks with emailSent=false; Cognito falls back to its default email).
  sendgridApiKey: z.string().nullish(),
  mailFrom: z.string().nullish(),
  // License (cash-based usage limit): recipient of charge-failure /
  // fx-fetch-failure alert mails. Empty = alerts are logged only.
  licenseAdminAlertEmail: z.string().nullish(),
  // MCP
  mcpEnabled: z.boolean().default(false),
  // Guardrail
  guardrailEnabled: z.boolean().default(false),
  // Usecase builder
  useCaseBuilderEnabled: z.boolean().default(true),
  // Manual RAG feature (manual reference mode)
  manualRagEnabled: z.boolean().default(false),
  // Flows
  flows: z
    .array(
      z.object({
        flowId: z.string(),
        aliasId: z.string(),
        flowName: z.string(),
        description: z.string(),
      })
    )
    .default([]),
  // WAF
  allowedIpV4AddressRanges: z.array(z.string()).nullish(),
  allowedIpV6AddressRanges: z.array(z.string()).nullish(),
  allowedCountryCodes: z.array(z.string()).nullish(),
  // Custom Domain
  hostName: z.string().nullish(),
  domainName: z.string().nullish(),
  hostedZoneId: z.string().nullish(),
  // Dashboard
  dashboard: z.boolean().default(false),
  // Tag
  tagKey: z.string().nullish(),
  tagValue: z.string().nullish(),
  // Closed network
  closedNetworkMode: z.boolean().default(false),
  closedNetworkVpcIpv4Cidr: z.string().default('10.0.0.0/16'),
  closedNetworkVpcId: z.string().nullish(),
  closedNetworkSubnetIds: z.array(z.string()).nullish(),
  closedNetworkCertificateArn: z.string().nullish(),
  closedNetworkDomainName: z.string().nullish(),
  closedNetworkCreateTestEnvironment: z.boolean().default(true),
  closedNetworkCreateResolverEndpoint: z.boolean().default(true),
});

// Common Validator with refine
export const stackInputSchema = baseStackInputSchema.refine(
  (data) => {
    // If searchApiKey is provided, searchEngine must also be provided
    if (data.searchApiKey && !data.searchEngine) {
      return false;
    }
    return true;
  },
  {
    message: 'searchEngine is required when searchApiKey is provided',
    path: ['searchEngine'],
  }
);

// schema after conversion
export const processedStackInputSchema = baseStackInputSchema.extend({
  modelIds: z.array(
    z.object({
      modelId: z.string(),
      region: z.string(),
      inferenceProfileArn: z.string().optional(),
    })
  ),
  imageGenerationModelIds: z.array(
    z.object({
      modelId: z.string(),
      region: z.string(),
      inferenceProfileArn: z.string().optional(),
    })
  ),
  videoGenerationModelIds: z.array(
    z.object({
      modelId: z.string(),
      region: z.string(),
      inferenceProfileArn: z.string().optional(),
    })
  ),
  speechToSpeechModelIds: z.array(
    z.object({
      modelId: z.string(),
      region: z.string(),
      inferenceProfileArn: z.string().optional(),
    })
  ),
  endpointNames: z.array(
    z.object({
      modelId: z.string(),
      region: z.string(),
    })
  ),
  // Processed agentCoreRegion (null -> modelRegion)
  agentCoreRegion: z.string(),
  // Branding configuration
  brandingConfig: z
    .object({
      logoPath: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
});

export type StackInput = z.infer<typeof stackInputSchema>;
export type ProcessedStackInput = z.infer<typeof processedStackInputSchema>;
