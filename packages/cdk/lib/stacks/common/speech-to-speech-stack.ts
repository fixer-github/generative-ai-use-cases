import { Stack, StackProps } from 'aws-cdk-lib';
import { ProcessedStackInput } from '../../stack-input';
import { Construct } from 'constructs';
import { SpeechToSpeech } from '../../construct';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';

interface SpeechToSpeechStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPool: UserPool;
  readonly restApi: RestApi;
}

class SpeechToSpeechStack extends Stack {
  readonly speechToSpeech: SpeechToSpeech;

  constructor(scope: Construct, id: string, props: SpeechToSpeechStackProps) {
    super(scope, id, props);

    const { params, userPool, restApi } = props;

    // SpeechToSpeech (for bidirectional communication)
    const speechToSpeech = new SpeechToSpeech(this, 'SpeechToSpeech', {
      envSuffix: params.env,
      api: restApi,
      userPool: userPool,
      speechToSpeechModelIds: params.speechToSpeechModelIds,
      crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
    });

    this.speechToSpeech = speechToSpeech;
  }
}

export default SpeechToSpeechStack;
