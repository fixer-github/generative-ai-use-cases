import { Stack, StackProps, CfnOutput, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Web } from '../../construct';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ProcessedStackInput } from '../../stack-input';
import { Flow } from 'generative-ai-use-cases';

export interface WebStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly idPoolId: string;
  readonly apiEndpointUrl: string;
  readonly predictStreamFunctionArn: string;
  readonly invokeFlowFunctionArn: string;
  readonly optimizePromptFunctionArn: string;
  readonly modelRegion: string;
  readonly modelIds: any;
  readonly imageGenerationModelIds: any;
  readonly videoGenerationModelIds: any;
  readonly endpointNames: any;
  readonly agentNames: any;
  readonly speechToSpeechNamespace: string;
  readonly speechToSpeechEventApiEndpoint: string;
  readonly mcpEndpoint?: string;
  readonly webAclId?: string;
  readonly cert?: ICertificate;
}

export class WebStack extends Stack {
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const params = props.params;

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
      speechToSpeechNamespace: props.speechToSpeechNamespace,
      speechToSpeechEventApiEndpoint: props.speechToSpeechEventApiEndpoint,
      speechToSpeechModelIds: params.speechToSpeechModelIds,
      mcpEnabled: params.mcpEnabled,
      mcpEndpoint: props.mcpEndpoint ?? null,
      hiddenUseCases: params.hiddenUseCases,
      cert: props.cert,
      hostName: params.hostName,
      domainName: params.domainName,
      hostedZoneId: params.hostedZoneId,
    });

    this.distributionDomainName = web.distribution.domainName;

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

    new CfnOutput(this, 'DistributionDomainName', {
      value: web.distribution.domainName,
      exportName: `${this.stackName}-DistributionDomainName`,
    });
  }
}
