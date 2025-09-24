import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface FileBucketStackProps extends cdk.StackProps {
  //
}

class FileBucketStack extends cdk.Stack {
  readonly fileBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: FileBucketStackProps) {
    super(scope, id, props);

    // S3 (File Bucket)
    const fileBucket = new s3.Bucket(this, 'FileBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });
    fileBucket.addCorsRule({
      allowedOrigins: ['*'],
      allowedMethods: [
        s3.HttpMethods.GET,
        s3.HttpMethods.POST,
        s3.HttpMethods.PUT,
      ],
      allowedHeaders: ['*'],
      exposedHeaders: [],
      maxAge: 3000,
    });

    this.fileBucket = fileBucket;
  }
}

export default FileBucketStack;
