import process from 'process';
import { Buffer } from 'buffer';
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RagKnowledgeBase } from '../../construct';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ProcessedStackInput } from '../../stack-input';
import { allowS3AccessWithSourceIpCondition } from '../../utils/s3-access-policy';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { ModelConfiguration } from 'generative-ai-use-cases';

export interface GenerativeAiUseCasesStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly knowledgeBaseId?: string;
  readonly userPool: cognito.UserPool;
  readonly restApi: RestApi;
  readonly knowledgeBaseDataSourceBucketName?: string;
  readonly getFileDownloadSignedUrlFunction: IFunction;

  // For CfnOutput
  // TODO: Remove later
  readonly modelRegion: string;
  readonly modelIds: ModelConfiguration[];
  readonly imageGenerationModelIds: ModelConfiguration[];
  readonly videoGenerationModelIds: ModelConfiguration[];
  readonly endpointNames: string[];
  readonly agentNames: string[];
}

export class GenerativeAiUseCasesStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: GenerativeAiUseCasesStackProps
  ) {
    super(scope, id, props);
    process.env.overrideWarningsEnabled = 'false';

    const { params } = props;

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

    // this.exportValue(this.userPool.userPoolId);
    // this.exportValue(this.userPoolClient.userPoolClientId);
  }
}
