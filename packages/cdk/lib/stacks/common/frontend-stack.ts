import { Stack, StackProps, CfnOutput, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { Web, SpeechToSpeech } from '../../construct';
import { ProcessedStackInput } from '../../stack-input';
import { ModelConfiguration } from 'generative-ai-use-cases';

export interface FrontendStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly idPoolId: string;
  readonly userPool: UserPool;
  readonly apiEndpointUrl: string;
  readonly restApi: RestApi;
  readonly predictStreamFunctionArn: string;
  readonly invokeFlowFunctionArn: string;
  readonly optimizePromptFunctionArn: string;
  readonly modelRegion: string;
  readonly modelIds: ModelConfiguration[];
  readonly imageGenerationModelIds: ModelConfiguration[];
  readonly videoGenerationModelIds: ModelConfiguration[];
  readonly endpointNames: string[];
  readonly agentNames: string[];
  readonly webAclId?: string;
  readonly cert?: ICertificate;
  readonly mcpEndpoint?: string;
}

export class FrontendStack extends Stack {
  public readonly distribution: Distribution;
  public readonly speechToSpeechNamespace: string;
  public readonly speechToSpeechEventApiEndpoint: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const params = props.params;

    const speechToSpeech = new SpeechToSpeech(this, 'SpeechToSpeech', {
      envSuffix: params.env,
      api: props.restApi,
      userPool: props.userPool,
      speechToSpeechModelIds: params.speechToSpeechModelIds,
      crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
    });

    const selfSignUpEnabledForWeb =
      params.samlAuthEnabled && !params.samlDefaultAuthEnabled
        ? false
        : params.selfSignUpEnabled;

    const web = new Web(this, 'Web', {
      userPoolId: props.userPoolId,
      userPoolClientId: props.userPoolClientId,
      idPoolId: props.idPoolId,
      selfSignUpEnabled: selfSignUpEnabledForWeb,
      samlAuthEnabled: params.samlAuthEnabled,
      samlDefaultAuthEnabled: params.samlDefaultAuthEnabled,
      samlCognitoDomainName: params.samlCognitoDomainName,
      samlCognitoFederatedIdentityProviderName:
        params.samlCognitoFederatedIdentityProviderName,
      apiEndpointUrl: props.apiEndpointUrl,
      predictStreamFunctionArn: props.predictStreamFunctionArn,
      ragEnabled: params.ragEnabled,
      ragKnowledgeBaseEnabled: params.ragKnowledgeBaseEnabled,
      agentEnabled: params.agentEnabled || params.agents.length > 0,
      flows: params.flows,
      flowStreamFunctionArn: props.invokeFlowFunctionArn,
      optimizePromptFunctionArn: props.optimizePromptFunctionArn,
      webAclId: props.webAclId,
      modelRegion: props.modelRegion,
      modelIds: props.modelIds,
      imageGenerationModelIds: props.imageGenerationModelIds,
      videoGenerationModelIds: props.videoGenerationModelIds,
      endpointNames: props.endpointNames,
      agentNames: props.agentNames,
      inlineAgents: params.inlineAgents,
      useCaseBuilderEnabled: params.useCaseBuilderEnabled,
      speechToSpeechNamespace: speechToSpeech.namespace,
      speechToSpeechEventApiEndpoint: speechToSpeech.eventApiEndpoint,
      speechToSpeechModelIds: params.speechToSpeechModelIds,
      mcpEnabled: params.mcpEnabled,
      mcpEndpoint: props.mcpEndpoint ?? null,
      hiddenUseCases: params.hiddenUseCases,
      cert: props.cert,
      hostName: params.hostName,
      domainName: params.domainName,
      hostedZoneId: params.hostedZoneId,
    });

    this.distribution = web.distribution;
    this.speechToSpeechNamespace = speechToSpeech.namespace;
    this.speechToSpeechEventApiEndpoint = speechToSpeech.eventApiEndpoint;

    new CfnOutput(this, 'Region', {
      value: this.region,
      exportName: `${this.stackName}-Region`,
    });

    if (params.hostName && params.domainName) {
      new CfnOutput(this, 'WebUrl', {
        value: `https://${params.hostName}.${params.domainName}`,
        exportName: `${this.stackName}-WebUrl`,
      });
    } else {
      new CfnOutput(this, 'WebUrl', {
        value: `https://${web.distribution.domainName}`,
        exportName: `${this.stackName}-WebUrl`,
      });
    }

    new CfnOutput(this, 'Flows', {
      value: Buffer.from(JSON.stringify(params.flows)).toString('base64'),
      exportName: `${this.stackName}-Flows`,
    });

    new CfnOutput(this, 'RagEnabled', {
      value: params.ragEnabled.toString(),
      exportName: `${this.stackName}-RagEnabled`,
    });

    new CfnOutput(this, 'RagKnowledgeBaseEnabled', {
      value: params.ragKnowledgeBaseEnabled.toString(),
      exportName: `${this.stackName}-RagKnowledgeBaseEnabled`,
    });

    new CfnOutput(this, 'AgentEnabled', {
      value: (params.agentEnabled || params.agents.length > 0).toString(),
      exportName: `${this.stackName}-AgentEnabled`,
    });

    new CfnOutput(this, 'SelfSignUpEnabled', {
      value: params.selfSignUpEnabled.toString(),
      exportName: `${this.stackName}-SelfSignUpEnabled`,
    });

    new CfnOutput(this, 'SamlAuthEnabled', {
      value: params.samlAuthEnabled.toString(),
      exportName: `${this.stackName}-SamlAuthEnabled`,
    });

    new CfnOutput(this, 'SamlDefaultAuthEnabled', {
      value: params.samlDefaultAuthEnabled.toString(),
      exportName: `${this.stackName}-SamlDefaultAuthEnabled`,
    });

    new CfnOutput(this, 'SamlCognitoDomainName', {
      value: params.samlCognitoDomainName ?? '',
      exportName: `${this.stackName}-SamlCognitoDomainName`,
    });

    new CfnOutput(this, 'SamlCognitoFederatedIdentityProviderName', {
      value: params.samlCognitoFederatedIdentityProviderName ?? '',
      exportName: `${this.stackName}-SamlCognitoFederatedIdentityProviderName`,
    });

    new CfnOutput(this, 'InlineAgents', {
      value: params.inlineAgents.toString(),
      exportName: `${this.stackName}-InlineAgents`,
    });

    new CfnOutput(this, 'UseCaseBuilderEnabled', {
      value: params.useCaseBuilderEnabled.toString(),
      exportName: `${this.stackName}-UseCaseBuilderEnabled`,
    });

    new CfnOutput(this, 'HiddenUseCases', {
      value: JSON.stringify(params.hiddenUseCases),
      exportName: `${this.stackName}-HiddenUseCases`,
    });

    new CfnOutput(this, 'SpeechToSpeechNamespace', {
      value: speechToSpeech.namespace,
      exportName: `${this.stackName}-SpeechToSpeechNamespace`,
    });

    new CfnOutput(this, 'SpeechToSpeechEventApiEndpoint', {
      value: speechToSpeech.eventApiEndpoint,
      exportName: `${this.stackName}-SpeechToSpeechEventApiEndpoint`,
    });

    new CfnOutput(this, 'SpeechToSpeechModelIds', {
      value: JSON.stringify(params.speechToSpeechModelIds),
      exportName: `${this.stackName}-SpeechToSpeechModelIds`,
    });

    new CfnOutput(this, 'McpEnabled', {
      value: params.mcpEnabled.toString(),
      exportName: `${this.stackName}-McpEnabled`,
    });

    new CfnOutput(this, 'LitellmProxyEnabled', {
      value: params.litellmProxyEnabled.toString(),
      exportName: `${this.stackName}-LitellmProxyEnabled`,
    });
  }
}