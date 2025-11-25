import { NestedStack, StackProps } from 'aws-cdk-lib';
import { ProcessedStackInput } from '../../stack-input';
import { Construct } from 'constructs';
import { TenantManager, Transcribe } from '../../construct';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { MethodOptions, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';

interface TranscribeStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly restApi: RestApi;
  readonly tenantManager: TenantManager;
  readonly commonAuthorizerProps: MethodOptions;
}

class TranscribeStack extends NestedStack {
  readonly transcribe: Transcribe;

  constructor(scope: Construct, id: string, props: TranscribeStackProps) {
    super(scope, id, props);

    const { params, userPool, idPool, restApi, tenantManager, commonAuthorizerProps } = props;

    // Transcribe
    const transcribe = new Transcribe(this, 'Transcribe', {
      userPool: userPool,
      idPool: idPool,
      api: restApi,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      tenantManager: tenantManager,
      environment: params.env,
      commonAuthorizerProps: commonAuthorizerProps,
    });

    this.transcribe = transcribe;
  }
}

export default TranscribeStack;
