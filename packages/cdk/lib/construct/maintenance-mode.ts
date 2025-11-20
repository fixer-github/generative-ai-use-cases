import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { CfnDistribution, Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as path from 'path';
import * as fs from 'fs';

export interface MaintenanceModeProps {
  /**
   * The CloudFront distribution to attach maintenance mode functions to
   */
  distribution: Distribution;
}

/**
 * Construct for implementing maintenance mode functionality using CloudFront Functions and KeyValueStore
 */
export class MaintenanceMode extends Construct {
  /**
   * The ARN of the KeyValueStore
   */
  public readonly kvsArn: string;

  /**
   * The name of the maintenance assets S3 bucket
   */
  public readonly maintenanceBucketName: string;

  /**
   * The KeyValueStore for maintenance mode state
   */
  public readonly keyValueStore: cloudfront.CfnKeyValueStore;

  /**
   * The S3 bucket for maintenance page assets
   */
  public readonly maintenanceBucket: s3.Bucket;

  /**
   * The ViewerRequest CloudFront Function
   */
  public readonly viewerRequestFunction: cloudfront.Function;

  /**
   * The ViewerResponse CloudFront Function
   */
  public readonly viewerResponseFunction: cloudfront.Function;

  constructor(scope: Construct, id: string, props: MaintenanceModeProps) {
    super(scope, id);

    // Task 1.2: Create S3 bucket for maintenance page assets
    this.maintenanceBucket = new s3.Bucket(this, 'MaintenanceBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.maintenanceBucketName = this.maintenanceBucket.bucketName;

    // Task 1.3: Create CloudFront KeyValueStore
    this.keyValueStore = new cloudfront.CfnKeyValueStore(
      this,
      'MaintenanceKVS',
      {
        name: 'MaintenanceModeStore',
        comment: 'KeyValueStore for maintenance mode state and IP whitelist',
      }
    );

    this.kvsArn = this.keyValueStore.attrArn;

    // Note: KeyValueStore must be initialized manually after deployment
    // Run the following AWS CLI commands to initialize:
    //
    // aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn <KVS_ARN>
    // aws cloudfront-keyvaluestore put-key --kvs-arn <KVS_ARN> --key maintenance --value false --if-match <ETAG>
    // aws cloudfront-keyvaluestore put-key --kvs-arn <KVS_ARN> --key ipWhitelist --value "" --if-match <ETAG>
    //
    // The KVS ARN will be output in CloudFormation outputs

    // Task 2.1 & 2.3: Create ViewerRequest CloudFront Function
    const viewerRequestCode = fs.readFileSync(
      path.join(__dirname, '../../cloudfront-functions/viewer-request.js'),
      'utf-8'
    );

    // Replace KVS_ID placeholder with actual KeyValueStore ID
    const viewerRequestCodeWithKVS = viewerRequestCode.replace(
      /kvsId = ['"]KVS_ID['"]/g,
      `kvsId = cloudfront.kvsId('${this.keyValueStore.attrId}')`
    );

    this.viewerRequestFunction = new cloudfront.Function(
      this,
      'ViewerRequestFunction',
      {
        code: cloudfront.FunctionCode.fromInline(viewerRequestCodeWithKVS),
        comment: 'Maintenance mode ViewerRequest function',
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        keyValueStore: this.keyValueStore,
      }
    );

    // Task 2.2 & 2.3: Create ViewerResponse CloudFront Function
    const viewerResponseCode = fs.readFileSync(
      path.join(__dirname, '../../cloudfront-functions/viewer-response.js'),
      'utf-8'
    );

    this.viewerResponseFunction = new cloudfront.Function(
      this,
      'ViewerResponseFunction',
      {
        code: cloudfront.FunctionCode.fromInline(viewerResponseCode),
        comment: 'Maintenance mode ViewerResponse function',
        runtime: cloudfront.FunctionRuntime.JS_2_0,
      }
    );

    // Task 4.3: Deploy maintenance page assets to S3
    // This will be populated with actual HTML/CSS files in Phase 4
    const maintenanceAssetsPath = path.join(
      __dirname,
      '../../assets/maintenance'
    );

    // Only deploy if the assets directory exists
    if (fs.existsSync(maintenanceAssetsPath)) {
      new s3deploy.BucketDeployment(this, 'DeployMaintenanceAssets', {
        sources: [s3deploy.Source.asset(maintenanceAssetsPath)],
        destinationBucket: this.maintenanceBucket,
        prune: false, // Don't delete existing files
      });
    }

    // Task 1.4 & 3.1: Create OAI and add maintenance bucket as CloudFront origin
    const oai = new cloudfront.OriginAccessIdentity(this, 'MaintenanceOAI', {
      comment: 'OAI for maintenance bucket access',
    });

    // Grant CloudFront OAI read permissions
    this.maintenanceBucket.grantRead(oai);

    // Task 3.2 & 3.3: Attach functions to distribution and configure behaviors
    // Use addPropertyOverride to properly handle CDK Tokens and ensure correct CloudFront configuration
    const cfnDistribution = props.distribution.node
      .defaultChild as CfnDistribution;

    const maintenanceOriginId = 'MaintenanceS3Origin';

    // Add maintenance bucket as an additional origin using addPropertyOverride
    // The .- suffix appends to the array
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.-', {
      id: maintenanceOriginId,
      domainName: this.maintenanceBucket.bucketRegionalDomainName,
      s3OriginConfig: {
        originAccessIdentity: `origin-access-identity/cloudfront/${oai.originAccessIdentityId}`,
      },
    });

    // Attach ViewerRequest function to default behavior
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.DefaultCacheBehavior.FunctionAssociations.-',
      {
        eventType: 'viewer-request',
        functionArn: this.viewerRequestFunction.functionArn,
      }
    );

    // Attach ViewerResponse function to default behavior
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.DefaultCacheBehavior.FunctionAssociations.-',
      {
        eventType: 'viewer-response',
        functionArn: this.viewerResponseFunction.functionArn,
      }
    );

    // Add cache behavior for maintenance.html
    cfnDistribution.addPropertyOverride('DistributionConfig.CacheBehaviors.-', {
      pathPattern: '/maintenance.html',
      targetOriginId: maintenanceOriginId,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD'],
      cachedMethods: ['GET', 'HEAD'],
      compress: true,
      cachePolicyId: cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
      functionAssociations: [
        {
          eventType: 'viewer-response',
          functionArn: this.viewerResponseFunction.functionArn,
        },
      ],
    });

    // Add cache behavior for maintenance.css
    cfnDistribution.addPropertyOverride('DistributionConfig.CacheBehaviors.-', {
      pathPattern: '/maintenance.css',
      targetOriginId: maintenanceOriginId,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD'],
      cachedMethods: ['GET', 'HEAD'],
      compress: true,
      cachePolicyId: cloudfront.CachePolicy.CACHING_OPTIMIZED.cachePolicyId,
      functionAssociations: [
        {
          eventType: 'viewer-response',
          functionArn: this.viewerResponseFunction.functionArn,
        },
      ],
    });
  }
}
