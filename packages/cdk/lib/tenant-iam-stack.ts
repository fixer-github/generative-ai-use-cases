import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface TenantIamStackProps extends StackProps {
  tenantId: string;
  accountPrincipal?: string; // Optional: AWS account ID that can assume this role
}

export class TenantIamStack extends Stack {
  public readonly tenantRole: iam.Role;

  constructor(scope: Construct, id: string, props: TenantIamStackProps) {
    super(scope, id, props);

    const { tenantId, accountPrincipal } = props;

    // Create the tenant-specific IAM role
    this.tenantRole = new iam.Role(this, `TenantRole-${tenantId}`, {
      roleName: `GaiXer-Tenant-${tenantId}-Role`,
      assumedBy: accountPrincipal 
        ? new iam.AccountPrincipal(accountPrincipal)
        : new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `IAM role for tenant ${tenantId} in GaiXer application`,
    });

    // Add basic Lambda execution permissions
    this.tenantRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Add tenant-specific permissions
    // These can be customized based on your requirements
    this.tenantRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:RequestedRegion': this.region,
          },
        },
      })
    );

    // Add S3 permissions for tenant-specific bucket/prefix
    this.tenantRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: [
          `arn:aws:s3:::*-gaixer-tenant-${tenantId}/*`,
          `arn:aws:s3:::*-gaixer-tenant-${tenantId}`,
        ],
      })
    );

    // Add DynamoDB permissions for tenant-specific data
    this.tenantRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/*`,
        ],
        conditions: {
          'ForAllValues:StringEquals': {
            'dynamodb:LeadingKeys': [tenantId],
          },
        },
      })
    );

    // Output the role ARN
    new CfnOutput(this, 'TenantRoleArn', {
      value: this.tenantRole.roleArn,
      description: `IAM Role ARN for tenant ${tenantId}`,
      exportName: `TenantRole-${tenantId}-Arn`,
    });

    // Output the role name
    new CfnOutput(this, 'TenantRoleName', {
      value: this.tenantRole.roleName,
      description: `IAM Role name for tenant ${tenantId}`,
      exportName: `TenantRole-${tenantId}-Name`,
    });
  }
}