import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ProcessedStackInput } from '../../stack-input';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { LAMBDA_RUNTIME_PYTHON } from '../../../consts';
import {
  LambdaVersion,
  UserPool,
  UserPoolOperation,
} from 'aws-cdk-lib/aws-cognito';

interface SharedStackProps extends StackProps {
  params: ProcessedStackInput;
  userPool: UserPool;
}

class SharedStack extends Stack {
  constructor(scope: Construct, id: string, props: SharedStackProps) {
    super(scope, id, props);

    const { params, userPool } = props;

    // Pre Token Generation Lambda for adding custom claims
    const preTokenGenerationFunction = new PythonFunction(
      this,
      'PreTokenGeneration',
      {
        runtime: LAMBDA_RUNTIME_PYTHON,
        entry: './lambda/pre_token_generation',
        timeout: Duration.seconds(5),
      }
    );

    userPool.addTrigger(
      UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenGenerationFunction,
      LambdaVersion.V2_0
    );
  }
}

export default SharedStack;
