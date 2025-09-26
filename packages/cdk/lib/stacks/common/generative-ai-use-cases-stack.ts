import process from 'process';
import { Buffer } from 'buffer';
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RagKnowledgeBase, Transcribe, CommonWebAcl } from '../../construct';
import { CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Agent, ModelConfiguration } from 'generative-ai-use-cases';
import { ProcessedStackInput } from '../../stack-input';
import { allowS3AccessWithSourceIpCondition } from '../../utils/s3-access-policy';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';

export interface GenerativeAiUseCasesStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  // RAG Knowledge Base
  readonly knowledgeBaseId?: string;
  readonly knowledgeBaseDataSourceBucketName?: string;
  // Agent
  readonly agents?: Agent[];
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

  // Auth
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly idPool: IdentityPool;

  // From other stack
  readonly modelRegion: string;
  readonly modelIds: ModelConfiguration[];
  readonly imageGenerationModelIds: ModelConfiguration[];
  readonly videoGenerationModelIds: ModelConfiguration[];
  readonly endpointNames: string[];
  readonly agentNames: string[];
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

    const { params } = props;

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
        resourceArn: props.restApi.deploymentStage.stageArn,
        webAclArn: regionalWaf.webAclArn,
      });
      new CfnWebACLAssociation(this, 'UserPoolWafAssociation', {
        resourceArn: props.userPool.userPoolArn,
        webAclArn: regionalWaf.webAclArn,
      });
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
          userPool: props.userPool,
          api: props.restApi,
        });
        // Allow downloading files from the File API to the data source Bucket
        if (
          props.knowledgeBaseDataSourceBucketName &&
          props.getFileDownloadSignedUrlFunction.role
        ) {
          allowS3AccessWithSourceIpCondition(
            props.knowledgeBaseDataSourceBucketName,
            props.getFileDownloadSignedUrlFunction.role,
            'read',
            {
              ipv4: params.allowedIpV4AddressRanges,
              ipv6: params.allowedIpV6AddressRanges,
            }
          );
        }
      }
    }

    // Transcribe
    new Transcribe(this, 'Transcribe', {
      userPool: props.userPool,
      idPool: props.idPool,
      api: props.restApi,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      tenantManager: tenantManager,
      environment: params.env,
    });

    // Cfn Outputs
    new CfnOutput(this, 'Region', {
      value: this.region,
    });

    new CfnOutput(this, 'Flows', {
      value: Buffer.from(JSON.stringify(params.flows)).toString('base64'),
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
      value: props.modelRegion,
    });

    new CfnOutput(this, 'ModelIds', {
      value: JSON.stringify(props.modelIds),
    });

    new CfnOutput(this, 'ImageGenerateModelIds', {
      value: JSON.stringify(props.imageGenerationModelIds),
    });

    new CfnOutput(this, 'VideoGenerateModelIds', {
      value: JSON.stringify(props.videoGenerationModelIds),
    });

    new CfnOutput(this, 'EndpointNames', {
      value: JSON.stringify(props.endpointNames),
    });

    new CfnOutput(this, 'SamlAuthEnabled', {
      value: params.samlAuthEnabled.toString(),
    });

    new CfnOutput(this, 'SamlDefaultAuthEnabled', {
      value: params.samlDefaultAuthEnabled.toString(),
    });

    new CfnOutput(this, 'SamlCognitoDomainName', {
      value: params.samlCognitoDomainName ?? '',
    });

    new CfnOutput(this, 'SamlCognitoFederatedIdentityProviderName', {
      value: params.samlCognitoFederatedIdentityProviderName ?? '',
    });

    new CfnOutput(this, 'AgentNames', {
      value: Buffer.from(JSON.stringify(props.agentNames)).toString('base64'),
    });

    new CfnOutput(this, 'InlineAgents', {
      value: params.inlineAgents.toString(),
    });

    new CfnOutput(this, 'HiddenUseCases', {
      value: JSON.stringify(params.hiddenUseCases),
    });

    new CfnOutput(this, 'McpEnabled', {
      value: params.mcpEnabled.toString(),
    });

    new CfnOutput(this, 'LitellmProxyEnabled', {
      value: params.litellmProxyEnabled.toString(),
    });

    this.userPool = props.userPool;
    this.userPoolClient = props.client;

    this.exportValue(this.userPool.userPoolId);
    this.exportValue(this.userPoolClient.userPoolClientId);
  }
}
