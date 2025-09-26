import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { ProcessedStackInput } from '../../stack-input';
import { Construct } from 'constructs';
import { UseCaseBuilder } from '../../construct/use-case-builder';
import { TenantManager } from '../../construct';

interface UseCaseBuilderStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly restApi: RestApi;
  readonly tenantManager: TenantManager;
}

class UseCaseBuilderStack extends Stack {
  readonly useCaseBuilder: UseCaseBuilder;

  constructor(scope: Construct, id: string, props: UseCaseBuilderStackProps) {
    super(scope, id, props);

    const { params, userPool, idPool, restApi, tenantManager } = props;

    const useCaseBuilder = new UseCaseBuilder(this, 'UseCaseBuilder', {
      userPool: userPool,
      api: restApi,
      idPool: idPool,
      environment: params.env,
      tenantManager: tenantManager,
    });

    new CfnOutput(this, 'UseCaseBuilderEnabled', {
      value: params.useCaseBuilderEnabled.toString(),
    });

    this.useCaseBuilder = useCaseBuilder;
  }
}

export default UseCaseBuilderStack;
