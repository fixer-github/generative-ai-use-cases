import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { McpApi } from '../../construct';

interface McpStackProps extends StackProps {
  readonly idPool: IdentityPool;
  readonly isSageMakerStudio: boolean;
  readonly fileBucket: Bucket;
}

class McpStack extends Stack {
  readonly endpoint: string;

  constructor(scope: Construct, id: string, props: McpStackProps) {
    super(scope, id, props);

    const { idPool, isSageMakerStudio, fileBucket } = props;

    const mcpApi = new McpApi(this, 'McpApi', {
      idPool: idPool,
      isSageMakerStudio: isSageMakerStudio,
      fileBucket: fileBucket,
    });

    const endpoint = mcpApi.endpoint;

    new CfnOutput(this, 'McpEndpoint', {
      value: endpoint,
    });

    this.endpoint = endpoint;
  }
}

export default McpStack;
