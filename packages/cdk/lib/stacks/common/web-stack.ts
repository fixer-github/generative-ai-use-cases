import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ProcessedStackInput } from '../../stack-input';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SpeechToSpeech, Web } from '../../construct';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';

interface WebStackProps extends StackProps {
  params: ProcessedStackInput;

  userPool: UserPool;
  client: UserPoolClient;
  idPool: IdentityPool;
  restApi: RestApi;
  predictStreamFunction: IFunction;
  invokeFlowFunction: IFunction;
  optimizePromptFunction: IFunction;
  webAclId?: string;
  agentNames: string[];
  speechToSpeech: SpeechToSpeech;
  mcpEndpoint?: string;
  cert?: ICertificate;
}

class WebStack extends Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const {
      params,
      userPool,
      client,
      idPool,
      restApi,
      predictStreamFunction,
      invokeFlowFunction,
      optimizePromptFunction,
      webAclId,
      agentNames,
      speechToSpeech,
      mcpEndpoint,
      cert,
    } = props;

    // Web Frontend
    const selfSignUpEnabledForWeb =
      params.samlAuthEnabled && !params.samlDefaultAuthEnabled
        ? false
        : params.selfSignUpEnabled;

    const web = new Web(this, 'Api', {
      // Auth
      userPoolId: userPool.userPoolId,
      userPoolClientId: client.userPoolClientId,
      idPoolId: idPool.identityPoolId,
      selfSignUpEnabled: selfSignUpEnabledForWeb,
      samlAuthEnabled: params.samlAuthEnabled,
      samlDefaultAuthEnabled: params.samlDefaultAuthEnabled,
      samlCognitoDomainName: params.samlCognitoDomainName,
      samlCognitoFederatedIdentityProviderName:
        params.samlCognitoFederatedIdentityProviderName,
      // Backend
      apiEndpointUrl: restApi.url,
      predictStreamFunctionArn: predictStreamFunction.functionArn,
      ragEnabled: params.ragEnabled,
      ragKnowledgeBaseEnabled: params.ragKnowledgeBaseEnabled,
      agentEnabled: params.agentEnabled || params.agents.length > 0,
      flows: params.flows,
      flowStreamFunctionArn: invokeFlowFunction.functionArn,
      optimizePromptFunctionArn: optimizePromptFunction.functionArn,
      webAclId: webAclId,
      modelRegion: params.modelRegion,
      modelIds: params.modelIds,
      imageGenerationModelIds: params.imageGenerationModelIds,
      videoGenerationModelIds: params.videoGenerationModelIds,
      endpointNames: params.endpointNames,
      agentNames: agentNames,
      inlineAgents: params.inlineAgents,
      useCaseBuilderEnabled: params.useCaseBuilderEnabled,
      speechToSpeechNamespace: speechToSpeech.namespace,
      speechToSpeechEventApiEndpoint: speechToSpeech.eventApiEndpoint,
      speechToSpeechModelIds: params.speechToSpeechModelIds,
      mcpEnabled: params.mcpEnabled,
      mcpEndpoint: mcpEndpoint ?? null,
      // Frontend
      hiddenUseCases: params.hiddenUseCases,
      // Custom Domain
      cert: cert,
      hostName: params.hostName,
      domainName: params.domainName,
      hostedZoneId: params.hostedZoneId,
    });
  }
}

export default WebStack;
