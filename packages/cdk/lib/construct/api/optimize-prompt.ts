import { Construct } from 'constructs';
import { GenericApiProps } from './props';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration } from 'aws-cdk-lib';

export type OptimizePromptApiProps = GenericApiProps;

class OptimizePromptApi extends Construct {
  readonly optimizePromptFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: OptimizePromptApiProps) {
    super(scope, id);

    const { idPool, modelRegion, bedrockPolicy } = props;

    const optimizePromptFunction = new NodejsFunction(
      this,
      'OptimizePromptFunction',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/optimizePrompt.ts',
        timeout: Duration.minutes(15),
        bundling: {
          nodeModules: ['@aws-sdk/client-bedrock-agent-runtime'],
        },
        environment: {
          MODEL_REGION: modelRegion,
        },
      }
    );

    // Add resource-based policy to allow invocation by authenticated identity pool users
    // This avoids circular dependencies between stacks
    optimizePromptFunction.addPermission('AllowAuthenticatedInvoke', {
      principal: new ServicePrincipal('cognito-identity.amazonaws.com'),
      action: 'lambda:InvokeFunction',
    });

    if (bedrockPolicy) {
      optimizePromptFunction.role?.addToPrincipalPolicy(bedrockPolicy);
    }

    this.optimizePromptFunction = optimizePromptFunction;
  }
}

export default OptimizePromptApi;
