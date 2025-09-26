import { Stack, StackProps } from 'aws-cdk-lib';
import { ProcessedStackInput } from '../../stack-input';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { TenantManager, Transcribe } from '../../construct';
import { Construct } from 'constructs';

interface TranscribeStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly restApi: RestApi;
  readonly tenantManager: TenantManager;
}

class TranscribeStack extends Stack {
  readonly transcribe: Transcribe;

  constructor(scope: Construct, id: string, props: TranscribeStackProps) {
    super(scope, id, props);

    const { params, userPool, idPool, restApi, tenantManager } = props;

    const transcribe = new Transcribe(this, 'Transcribe', {
      userPool: userPool,
      idPool: idPool,
      api: restApi,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      tenantManager: tenantManager,
      environment: params.env,
    });

    this.transcribe = transcribe;
  }
}

export default TranscribeStack;
