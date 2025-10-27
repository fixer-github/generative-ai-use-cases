import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration } from 'aws-cdk-lib';
import { GenericApiProps } from './props';

export type ModelsApiProps = GenericApiProps;

class ModelsApi extends Construct {
  constructor(scope: Construct, id: string, props: ModelsApiProps) {
    super(scope, id);

    const {
      api,
      commonAuthorizerProps,
      modelRegion,
      modelIds,
      imageGenerationModelIds,
      videoGenerationModelIds,
      endpointNames,
      agentMap,
      flows,
    } = props;

    const modelsResource = api.root.addResource('models');

    const agentNames = Object.keys(agentMap);

    const getModelsFunction = new NodejsFunction(this, 'GetModels', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getModels.ts',
      timeout: Duration.seconds(30),
      environment: {
        MODEL_REGION: modelRegion,
        MODEL_IDS: JSON.stringify(modelIds),
        IMAGE_MODEL_IDS: JSON.stringify(imageGenerationModelIds),
        VIDEO_MODEL_IDS: JSON.stringify(videoGenerationModelIds),
        SPEECH_TO_SPEECH_MODEL_IDS: JSON.stringify([]),
        ENDPOINT_NAMES: JSON.stringify(endpointNames),
        AGENT_NAMES: JSON.stringify(agentNames),
        FLOWS: JSON.stringify(flows || []),
      },
    });

    modelsResource.addMethod(
      'GET',
      new LambdaIntegration(getModelsFunction),
      commonAuthorizerProps
    );
  }
}

export default ModelsApi;
