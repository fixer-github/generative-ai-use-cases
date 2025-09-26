import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ProcessedStackInput } from '../../stack-input';
import { LitellmProxyServer } from '../../construct';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';

interface LitellmProxyServerStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly isSageMakerStudio: boolean;
  readonly idPool: IdentityPool;
}

class LitellmProxyServerStack extends Stack {
  readonly litellmProxy: LitellmProxyServer;
  readonly endpoint: string;

  constructor(
    scope: Construct,
    id: string,
    props: LitellmProxyServerStackProps
  ) {
    super(scope, id, props);

    const { params, isSageMakerStudio, idPool } = props;

    const litellmProxy = new LitellmProxyServer(this, 'LitellmProxyServer', {
      modelRegion: params.modelRegion,
      crossAccountBedrockRoleArn:
        params.crossAccountBedrockRoleArn ?? undefined,
      isSageMakerStudio: isSageMakerStudio,
      idPool: idPool,
    });

    const litellmEndpoint = litellmProxy.endpoint;

    new CfnOutput(this, 'LitellmProxyEndpoint', {
      value: litellmEndpoint,
    });

    this.litellmProxy = litellmProxy;
    this.endpoint = litellmEndpoint;
  }
}

export default LitellmProxyServerStack;
