import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  Bucket,
  BlockPublicAccess,
  BucketEncryption,
} from 'aws-cdk-lib/aws-s3';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';

/**
 * Storage for the Manual RAG feature (B1).
 * - S3: stores manual originals, page images (PNG), page texts (MD), table of
 *   contents and page_map.json (key layout: design doc section 3.1).
 * - DynamoDB: single table holding manual metadata (9 attributes, design doc section 3.2).
 *
 * removalPolicy is RETAIN because manual originals and metadata are user assets and
 * must not be deleted by accident (decided 2026-05-29).
 * IAM grants for the Lambdas / API Gateway / AgentCore are added in later phases
 * (B2 onward) by referencing these resources.
 */
export class ManualStorage extends Construct {
  public readonly bucket: Bucket;
  public readonly table: ddb.Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.bucket = new Bucket(this, 'ManualBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.table = new ddb.Table(this, 'ManualTable', {
      partitionKey: {
        name: 'manual_id',
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
