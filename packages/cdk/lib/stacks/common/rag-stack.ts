import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { ProcessedStackInput } from '../../stack-input';
import { Construct } from 'constructs';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { allowS3AccessWithSourceIpCondition } from '../../utils/s3-access-policy';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Rag } from '../../construct';

interface RagStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPool: UserPool;
  readonly restApi: RestApi;
  readonly getFileDownloadSignedUrlFunction: IFunction;
}

class RagStack extends Stack {
  readonly rag: Rag;

  constructor(scope: Construct, id: string, props: RagStackProps) {
    super(scope, id, props);

    const { params, userPool, restApi, getFileDownloadSignedUrlFunction } =
      props;

    const rag = new Rag(this, 'Rag', {
      envSuffix: params.env,
      kendraIndexLanguage: params.kendraIndexLanguage,
      kendraIndexArnInCdkContext: params.kendraIndexArn,
      kendraDataSourceBucketName: params.kendraDataSourceBucketName,
      kendraIndexScheduleEnabled: params.kendraIndexScheduleEnabled,
      kendraIndexScheduleCreateCron: params.kendraIndexScheduleCreateCron,
      kendraIndexScheduleDeleteCron: params.kendraIndexScheduleDeleteCron,
      userPool: userPool,
      api: restApi,
    });

    // Allow downloading files from the File API to the data source Bucket
    // If you are importing existing Kendra, there is a possibility that the data source is not S3
    // In that case, rag.dataSourceBucketName will be undefined and the permission will not be granted
    if (rag.dataSourceBucketName && getFileDownloadSignedUrlFunction.role) {
      allowS3AccessWithSourceIpCondition(
        rag.dataSourceBucketName,
        getFileDownloadSignedUrlFunction.role,
        'read',
        {
          ipv4: params.allowedIpV4AddressRanges,
          ipv6: params.allowedIpV6AddressRanges,
        }
      );
    }

    new CfnOutput(this, 'RagEnabled', {
      value: params.ragEnabled.toString(),
    });

    this.rag = rag;
  }
}

export default RagStack;
