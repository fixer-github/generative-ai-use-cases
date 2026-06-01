import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Auth,
  Api,
  AdminApi,
  Web,
  Database,
  Rag,
  RagKnowledgeBase,
  Transcribe,
  CommonWebAcl,
  SpeechToSpeech,
  McpApi,
  AgentCore,
  Scheduler,
  BackupLockedBuckets,
  CognitoExportConstruct,
  DdbPitrExportConstruct,
  S3ReplicationConstruct,
  RestoreRoleConstruct,
} from './construct';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { loadMCPConfig, extractSafeMCPConfig } from './utils/mcp-config-loader';
import { CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { UseCaseBuilder } from './construct/use-case-builder';
import { AgentBuilder } from './construct/agent-builder';
import { ProcessedStackInput } from './stack-input';
import { allowS3AccessWithSourceIpCondition } from './utils/s3-access-policy';
import {
  InterfaceVpcEndpoint,
  IVpc,
  ISecurityGroup,
  SecurityGroup,
} from 'aws-cdk-lib/aws-ec2';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { AgentCoreStack } from './agent-core-stack';
import * as path from 'path';
import { RemoteOutputs } from 'cdk-remote-stack';
import { REMOTE_OUTPUT_KEYS } from './remote-output-keys';

export interface GenerativeAiUseCasesStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  // RAG Knowledge Base
  readonly knowledgeBaseId?: string;
  readonly knowledgeBaseDataSourceBucketName?: string;
  // Agent
  readonly agentStack?: Stack;
  // Agent Core
  readonly createGenericAgentCoreRuntime?: boolean;
  readonly agentBuilderEnabled?: boolean;
  readonly agentCoreStack?: AgentCoreStack;
  // Video Generation
  readonly videoBucketRegionMap: Record<string, string>;
  // Guardrail
  readonly guardrailIdentifier?: string;
  readonly guardrailVersion?: string;
  // WAF
  readonly webAclId?: string;
  // Custom Domain
  readonly cert?: ICertificate;
  // Image build environment
  readonly isSageMakerStudio: boolean;
  // Closed network
  readonly vpc?: IVpc;
  readonly apiGatewayVpcEndpoint?: InterfaceVpcEndpoint;
  readonly webBucket?: Bucket;
  readonly cognitoUserPoolProxyEndpoint?: string;
  readonly cognitoIdentityPoolProxyEndpoint?: string;
}

export class GenerativeAiUseCasesStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(
    scope: Construct,
    id: string,
    props: GenerativeAiUseCasesStackProps
  ) {
    super(scope, id, props);
    process.env.overrideWarningsEnabled = 'false';

    const params = props.params;

    // Get values from other stacks using RemoteOutputs
    let agentsJson: string | undefined;

    // Agent RemoteOutputs
    if (params.agentEnabled && props.agentStack) {
      const agentRemoteOutputs = new RemoteOutputs(this, 'AgentRemoteOutputs', {
        stack: props.agentStack,
        alwaysUpdate: true,
      });
      agentsJson = agentRemoteOutputs.get(REMOTE_OUTPUT_KEYS.AGENTS);
    }

    let genericRuntimeArn: string | undefined;
    let genericRuntimeName: string | undefined;
    let agentBuilderRuntimeArn: string | undefined;
    let agentBuilderRuntimeName: string | undefined;

    // Get runtime info from remote AgentCore stack using cdk-remote-stack
    if (params.createGenericAgentCoreRuntime || params.agentBuilderEnabled) {
      const remoteOutputs = new RemoteOutputs(this, 'AgentCoreRemoteOutputs', {
        stack: props.agentCoreStack!,
      });

      if (params.createGenericAgentCoreRuntime) {
        genericRuntimeArn = remoteOutputs.get('GenericAgentCoreRuntimeArn');
        genericRuntimeName = remoteOutputs.get('GenericAgentCoreRuntimeName');
      }

      if (params.agentBuilderEnabled) {
        agentBuilderRuntimeArn = remoteOutputs.get(
          'AgentBuilderAgentCoreRuntimeArn'
        );
        agentBuilderRuntimeName = remoteOutputs.get(
          'AgentBuilderAgentCoreRuntimeName'
        );
      }
    }

    // Common security group for saving ENI in Closed network mode
    let securityGroups: ISecurityGroup[] | undefined = undefined;
    if (props.vpc) {
      securityGroups = [
        new SecurityGroup(this, 'LambdaSeurityGroup', {
          vpc: props.vpc,
          description: 'GenU Lambda Security Group',
          allowAllOutbound: true,
        }),
      ];
    }

    // Auth
    const auth = new Auth(this, 'Auth', {
      selfSignUpEnabled: params.selfSignUpEnabled,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      allowedSignUpEmailDomains: params.allowedSignUpEmailDomains,
      mfaRequired: params.mfaRequired,
      samlAuthEnabled: params.samlAuthEnabled,
    });

    // Database
    const database = new Database(this, 'Database');

    // API
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
      additionalS3Buckets: [
        ...(props.agentCoreStack?.fileBucket
          ? [props.agentCoreStack.fileBucket]
          : []),
        ...(params.additionalS3Buckets ?? []).map((name, i) =>
          Bucket.fromBucketName(this, `ExternalBucket${i}`, name)
        ),
      ],
      userPool: auth.userPool,
      idPool: auth.idPool,
      userPoolClient: auth.client,
      table: database.table,
      statsTable: database.statsTable,
      knowledgeBaseId: params.ragKnowledgeBaseId || props.knowledgeBaseId,
      agents: agentsJson,
      guardrailIdentify: props.guardrailIdentifier,
      guardrailVersion: props.guardrailVersion,
      vpc: props.vpc,
      securityGroups,
      apiGatewayVpcEndpoint: props.apiGatewayVpcEndpoint,
      cognitoUserPoolProxyEndpoint: props.cognitoUserPoolProxyEndpoint,
      searchApiKey: params.searchApiKey,
      searchEngine: params.searchEngine,
      searchApiKeySsmParameterName: params.searchApiKeySsmParameterName,
    });

    // Admin API
    new AdminApi(this, 'AdminApi', {
      userPool: auth.userPool,
      api: api.api,
      vpc: props.vpc,
      securityGroups,
    });

    // WAF
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
        resourceArn: api.api.deploymentStage.stageArn,
        webAclArn: regionalWaf.webAclArn,
      });
      new CfnWebACLAssociation(this, 'UserPoolWafAssociation', {
        resourceArn: auth.userPool.userPoolArn,
        webAclArn: regionalWaf.webAclArn,
      });
    }

    // SpeechToSpeech (for bidirectional communication)
    let speechToSpeechNamespace = '';
    let speechToSpeechEventApiEndpoint = '';
    if (params.speechToSpeechEnabled) {
      const speechToSpeech = new SpeechToSpeech(this, 'SpeechToSpeech', {
        envSuffix: params.env,
        api: api.api,
        userPool: auth.userPool,
        speechToSpeechModelIds: params.speechToSpeechModelIds,
        crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
        vpc: props.vpc,
        securityGroups,
      });
      speechToSpeechNamespace = speechToSpeech.namespace;
      speechToSpeechEventApiEndpoint = speechToSpeech.eventApiEndpoint;
    }

    // Load MCP configuration for Web frontend
    const mcpServers = loadMCPConfig(
      path.join(
        __dirname,
        '../lambda-python/generic-agent-core-runtime/mcp-configs/agent-builder/mcp.json'
      )
    );
    const safeMCPConfig = extractSafeMCPConfig(mcpServers);

    // MCP
    let mcpEndpoint: string | null = null;
    if (params.mcpEnabled) {
      const mcpApi = new McpApi(this, 'McpApi', {
        idPool: auth.idPool,
        isSageMakerStudio: props.isSageMakerStudio,
        fileBucket: api.fileBucket,
        vpc: props.vpc,
        securityGroups,
      });
      mcpEndpoint = mcpApi.endpoint;
    }

    // Create AgentCore construct for external runtimes and permissions
    if (
      params.agentCoreExternalRuntimes.length > 0 ||
      genericRuntimeArn ||
      agentBuilderRuntimeArn
    ) {
      new AgentCore(this, 'AgentCore', {
        agentCoreExternalRuntimes: params.agentCoreExternalRuntimes,
        idPool: auth.idPool,
        genericRuntimeArn,
        agentBuilderRuntimeArn,
      });
    }

    // Web Frontend
    const web = new Web(this, 'Api', {
      // Auth
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.client.userPoolClientId,
      idPoolId: auth.idPool.identityPoolId,
      selfSignUpEnabled: params.selfSignUpEnabled,
      mfaRequired: params.mfaRequired,
      samlAuthEnabled: params.samlAuthEnabled,
      samlCognitoDomainName: params.samlCognitoDomainName,
      samlCognitoFederatedIdentityProviderName:
        params.samlCognitoFederatedIdentityProviderName,
      // Backend
      apiEndpointUrl: api.api.url,
      predictStreamFunctionArn: api.predictStreamFunction.functionArn,
      ragEnabled: params.ragEnabled,
      ragKnowledgeBaseEnabled: params.ragKnowledgeBaseEnabled,
      agentEnabled: params.agentEnabled || params.agents.length > 0,
      flows: params.flows,
      flowStreamFunctionArn: api.invokeFlowFunction.functionArn,
      optimizePromptFunctionArn: api.optimizePromptFunction.functionArn,
      webAclId: props.webAclId,
      modelRegion: api.modelRegion,
      modelIds: api.modelIds,
      imageGenerationModelIds: api.imageGenerationModelIds,
      videoGenerationModelIds: api.videoGenerationModelIds,
      endpointNames: api.endpointNames,
      builtinAgentsJson: agentsJson || '[]',
      customAgentsJson: JSON.stringify(params.agents),
      inlineAgents: params.inlineAgents,
      useCaseBuilderEnabled: params.useCaseBuilderEnabled,
      speechToSpeechEnabled: params.speechToSpeechEnabled,
      speechToSpeechNamespace,
      speechToSpeechEventApiEndpoint,
      speechToSpeechModelIds: params.speechToSpeechEnabled
        ? params.speechToSpeechModelIds
        : [],
      mcpEnabled: params.mcpEnabled,
      mcpEndpoint,
      mcpServersConfig: safeMCPConfig,
      agentCoreEnabled:
        params.createGenericAgentCoreRuntime ||
        params.agentCoreExternalRuntimes.length > 0,
      agentCoreGenericRuntime: genericRuntimeArn
        ? {
            name: genericRuntimeName || 'GenericAgentCoreRuntime',
            displayName: genericRuntimeName || 'GenericAgentCoreRuntime',
            arn: genericRuntimeArn,
            description: 'Generic Agent Core Runtime for custom agents',
          }
        : undefined,
      agentBuilderEnabled: params.agentBuilderEnabled,
      agentCoreAgentBuilderRuntime: agentBuilderRuntimeArn
        ? {
            name: agentBuilderRuntimeName || 'AgentBuilderAgentCoreRuntime',
            displayName:
              agentBuilderRuntimeName || 'AgentBuilderAgentCoreRuntime',
            arn: agentBuilderRuntimeArn,
            description: 'Agent Core Runtime for AgentBuilder',
          }
        : undefined,
      agentCoreExternalRuntimes: params.agentCoreExternalRuntimes,
      agentCoreRegion: params.agentCoreRegion,
      schedulerEnabled:
        params.createGenericAgentCoreRuntime ||
        params.agentCoreExternalRuntimes.length > 0,
      // Frontend
      hiddenUseCases: params.hiddenUseCases,
      // Custom Domain
      cert: props.cert,
      hostName: params.hostName,
      domainName: params.domainName,
      hostedZoneId: params.hostedZoneId,
      // Closed network
      webBucket: props.webBucket,
      cognitoUserPoolProxyEndpoint: props.cognitoUserPoolProxyEndpoint,
      cognitoIdentityPoolProxyEndpoint: props.cognitoIdentityPoolProxyEndpoint,
      // Branding
      brandingConfig: params.brandingConfig,
    });

    // RAG
    if (params.ragEnabled) {
      const rag = new Rag(this, 'Rag', {
        envSuffix: params.env,
        kendraIndexLanguage: params.kendraIndexLanguage,
        kendraIndexArnInCdkContext: params.kendraIndexArn,
        kendraDataSourceBucketName: params.kendraDataSourceBucketName,
        kendraIndexScheduleEnabled: params.kendraIndexScheduleEnabled,
        kendraIndexScheduleCreateCron: params.kendraIndexScheduleCreateCron,
        kendraIndexScheduleDeleteCron: params.kendraIndexScheduleDeleteCron,
        userPool: auth.userPool,
        api: api.api,
        vpc: props.vpc,
        securityGroups,
      });

      // Allow downloading files from the File API to the data source Bucket
      // If you are importing existing Kendra, there is a possibility that the data source is not S3
      // In that case, rag.dataSourceBucketName will be undefined and the permission will not be granted
      if (
        rag.dataSourceBucketName &&
        api.getFileDownloadSignedUrlFunction.role
      ) {
        allowS3AccessWithSourceIpCondition(
          rag.dataSourceBucketName,
          api.getFileDownloadSignedUrlFunction.role,
          'read',
          {
            ipv4: params.allowedIpV4AddressRanges,
            ipv6: params.allowedIpV6AddressRanges,
          }
        );
      }
    }

    // RAG Knowledge Base
    if (params.ragKnowledgeBaseEnabled) {
      const knowledgeBaseId =
        params.ragKnowledgeBaseId || props.knowledgeBaseId;
      if (knowledgeBaseId) {
        new RagKnowledgeBase(this, 'RagKnowledgeBase', {
          modelRegion: params.modelRegion,
          crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
          knowledgeBaseId: knowledgeBaseId,
          userPool: auth.userPool,
          api: api.api,
          vpc: props.vpc,
          securityGroups,
        });
        // Allow downloading files from the File API to the data source Bucket
        if (
          props.knowledgeBaseDataSourceBucketName &&
          api.getFileDownloadSignedUrlFunction.role
        ) {
          allowS3AccessWithSourceIpCondition(
            props.knowledgeBaseDataSourceBucketName,
            api.getFileDownloadSignedUrlFunction.role,
            'read',
            {
              ipv4: params.allowedIpV4AddressRanges,
              ipv6: params.allowedIpV6AddressRanges,
            }
          );
        }
      }
    }

    // UseCaseBuilder - create only if UseCaseBuilder or AgentBuilder is enabled
    let useCaseBuilder: UseCaseBuilder | undefined;
    if (params.useCaseBuilderEnabled || params.agentBuilderEnabled) {
      useCaseBuilder = new UseCaseBuilder(this, 'UseCaseBuilder', {
        userPool: auth.userPool,
        api: api.api,
        vpc: props.vpc,
        securityGroups,
        useCaseBuilderEnabled: params.useCaseBuilderEnabled,
      });
    }

    // Agent Builder (if enabled and runtime is available)
    if (
      params.agentBuilderEnabled &&
      agentBuilderRuntimeArn &&
      useCaseBuilder
    ) {
      new AgentBuilder(this, 'AgentBuilder', {
        userPool: auth.userPool,
        api: api.api,
        vpc: props.vpc,
        securityGroups,
        agentBuilderRuntimeArn,
        useCaseBuilderTable: useCaseBuilder.useCaseBuilderTable,
        useCaseIdIndexName: useCaseBuilder.useCaseIdIndexName,
        cognitoUserPoolProxyEndpoint: props.cognitoUserPoolProxyEndpoint,
      });
    }

    // Scheduler
    // Build agentName->ARN mapping from available runtimes
    const agentNameToArnMap: Record<string, string> = {};
    if (genericRuntimeArn && genericRuntimeName) {
      agentNameToArnMap[genericRuntimeName] = genericRuntimeArn;
    }
    for (const runtime of params.agentCoreExternalRuntimes) {
      agentNameToArnMap[runtime.name] = runtime.arn;
    }
    if (Object.keys(agentNameToArnMap).length > 0) {
      new Scheduler(this, 'Scheduler', {
        userPool: auth.userPool,
        api: api.api,
        agentNameToArnMap,
        modelRegion: params.modelRegion,
        agentCoreRegion: params.agentCoreRegion,
        sendgridApiKey: params.schedulerSendgridApiKey,
        mailFrom: params.schedulerMailFrom,
        closedNetworkMode: params.closedNetworkMode,
        vpc: props.vpc,
        securityGroups,
      });
    }

    // Transcribe
    new Transcribe(this, 'Transcribe', {
      userPool: auth.userPool,
      idPool: auth.idPool,
      api: api.api,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      vpc: props.vpc,
      securityGroups,
    });

    // ===== Backup Resources (wiring Phase 2-6 constructs) =====
    // Phase 2: Three isolated backup buckets (Object Lock Compliance 90 days)
    const backupBuckets = new BackupLockedBuckets(this, 'BackupLockedBuckets', {
      env: params.env,
    });

    // Phase 3: Cognito periodic export (daily at JST 00:00)
    new CognitoExportConstruct(this, 'CognitoExport', {
      userPool: auth.userPool,
      exportBucket: backupBuckets.cognitoExportBucket,
    });

    // Phase 4: DynamoDB PITR Export (daily at JST 04:30, UseCaseBuilder is conditional)
    const ddbTables: dynamodb.ITable[] = [database.table, database.statsTable];
    if (useCaseBuilder) {
      ddbTables.push(useCaseBuilder.useCaseBuilderTable);
    }
    new DdbPitrExportConstruct(this, 'DdbPitrExport', {
      tables: ddbTables,
      exportBucket: backupBuckets.ddbExportBucket,
    });

    // Phase 5: SRR from FileBucket to s3ReplicationBucket
    new S3ReplicationConstruct(this, 'S3Replication', {
      sourceBuckets: [api.fileBucket],
      destinationBucket: backupBuckets.s3ReplicationBucket,
    });

    // Phase 6: IAM Role for restoration operators (AccountPrincipal + MFA required condition, 4h session)
    new RestoreRoleConstruct(this, 'RestoreRole', {
      trustedPrincipal: new iam.AccountPrincipal(this.account).withConditions({
        Bool: { 'aws:MultiFactorAuthPresent': 'true' },
      }),
      tables: ddbTables,
      userPool: auth.userPool,
      sourceBuckets: [api.fileBucket],
      backupBuckets: [
        backupBuckets.ddbExportBucket,
        backupBuckets.s3ReplicationBucket,
        backupBuckets.cognitoExportBucket,
      ],
    });

    // Cfn Outputs
    new CfnOutput(this, 'Region', {
      value: this.region,
    });

    new CfnOutput(this, 'WebUrl', {
      value: web.webUrl,
    });

    new CfnOutput(this, 'ApiEndpoint', {
      value: api.api.url,
    });

    new CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });

    new CfnOutput(this, 'UserPoolClientId', {
      value: auth.client.userPoolClientId,
    });

    new CfnOutput(this, 'IdPoolId', { value: auth.idPool.identityPoolId });

    new CfnOutput(this, 'PredictStreamFunctionArn', {
      value: api.predictStreamFunction.functionArn,
    });

    new CfnOutput(this, 'OptimizePromptFunctionArn', {
      value: api.optimizePromptFunction.functionArn,
    });

    new CfnOutput(this, 'InvokeFlowFunctionArn', {
      value: api.invokeFlowFunction.functionArn,
    });

    new CfnOutput(this, 'Flows', {
      value: Buffer.from(JSON.stringify(params.flows)).toString('base64'),
    });

    new CfnOutput(this, 'RagEnabled', {
      value: params.ragEnabled.toString(),
    });

    new CfnOutput(this, 'RagKnowledgeBaseEnabled', {
      value: params.ragKnowledgeBaseEnabled.toString(),
    });

    new CfnOutput(this, 'AgentEnabled', {
      value: (params.agentEnabled || params.agents.length > 0).toString(),
    });

    new CfnOutput(this, 'SelfSignUpEnabled', {
      value: params.selfSignUpEnabled.toString(),
    });

    new CfnOutput(this, 'ModelRegion', {
      value: api.modelRegion,
    });

    new CfnOutput(this, 'ModelIds', {
      value: JSON.stringify(api.modelIds),
    });

    new CfnOutput(this, 'ImageGenerateModelIds', {
      value: JSON.stringify(api.imageGenerationModelIds),
    });

    new CfnOutput(this, 'VideoGenerateModelIds', {
      value: JSON.stringify(api.videoGenerationModelIds),
    });

    new CfnOutput(this, 'EndpointNames', {
      value: JSON.stringify(api.endpointNames),
    });

    new CfnOutput(this, 'SamlAuthEnabled', {
      value: params.samlAuthEnabled.toString(),
    });

    new CfnOutput(this, 'SamlCognitoDomainName', {
      value: params.samlCognitoDomainName ?? '',
    });

    new CfnOutput(this, 'SamlCognitoFederatedIdentityProviderName', {
      value: params.samlCognitoFederatedIdentityProviderName ?? '',
    });

    new CfnOutput(this, 'Agents', {
      value: Buffer.from(JSON.stringify(api.agents)).toString('base64'),
    });

    new CfnOutput(this, 'InlineAgents', {
      value: params.inlineAgents.toString(),
    });

    new CfnOutput(this, 'UseCaseBuilderEnabled', {
      value: params.useCaseBuilderEnabled.toString(),
    });

    new CfnOutput(this, 'HiddenUseCases', {
      value: JSON.stringify(params.hiddenUseCases),
    });

    new CfnOutput(this, 'SpeechToSpeechEnabled', {
      value: params.speechToSpeechEnabled.toString(),
    });

    new CfnOutput(this, 'SpeechToSpeechNamespace', {
      value: speechToSpeechNamespace,
    });

    new CfnOutput(this, 'SpeechToSpeechEventApiEndpoint', {
      value: speechToSpeechEventApiEndpoint,
    });

    new CfnOutput(this, 'SpeechToSpeechModelIds', {
      value: JSON.stringify(
        params.speechToSpeechEnabled ? params.speechToSpeechModelIds : []
      ),
    });

    new CfnOutput(this, 'McpEnabled', {
      value: params.mcpEnabled.toString(),
    });

    new CfnOutput(this, 'McpEndpoint', {
      value: mcpEndpoint ?? '',
    });

    new CfnOutput(this, 'AgentCoreEnabled', {
      value: (
        params.createGenericAgentCoreRuntime ||
        params.agentCoreExternalRuntimes.length > 0
      ).toString(),
    });

    new CfnOutput(this, 'AgentCoreGenericRuntime', {
      value: genericRuntimeArn
        ? JSON.stringify({
            name: genericRuntimeName || 'GenericAgentCoreRuntime',
            arn: genericRuntimeArn,
          })
        : 'null',
    });

    new CfnOutput(this, 'AgentCoreAgentBuilderEnabled', {
      value: params.agentBuilderEnabled.toString(),
    });

    new CfnOutput(this, 'AgentCoreAgentBuilderRuntime', {
      value: agentBuilderRuntimeArn
        ? JSON.stringify({
            name: agentBuilderRuntimeName || 'AgentBuilderAgentCoreRuntime',
            arn: agentBuilderRuntimeArn,
          })
        : 'null',
    });

    new CfnOutput(this, 'AgentCoreExternalRuntimes', {
      value: JSON.stringify(params.agentCoreExternalRuntimes),
    });

    new CfnOutput(this, 'McpServersConfig', {
      value: safeMCPConfig,
    });

    this.userPool = auth.userPool;
    this.userPoolClient = auth.client;

    this.exportValue(this.userPool.userPoolId);
    this.exportValue(this.userPoolClient.userPoolClientId);
  }
}
