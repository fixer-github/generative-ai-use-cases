import { Stack, StackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { ModelConfiguration } from 'generative-ai-use-cases';

interface ApiStackProps extends StackProps {
  // From other stack

  // S3
  readonly fileBucket: Bucket;
}

class ApiStack extends Stack {
  readonly restApi: RestApi;

  readonly predictStreamFunction: NodejsFunction;
  readonly invokeFlowFunction: NodejsFunction;
  readonly optimizePromptFunction: NodejsFunction;
  readonly getFileDownloadSignedUrlFunction: NodejsFunction;

  readonly modelRegion: string;
  readonly modelIds: ModelConfiguration[];
  readonly imageGenerationModelIds: ModelConfiguration[];
  readonly videoGenerationModelIds: ModelConfiguration[];
  readonly endpointNames: string[];
  readonly agentNames: string[];

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
  }
}

export default ApiStack;
