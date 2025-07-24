import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface TenantDynamoDBStackProps extends StackProps {
  tenantId: string;
  dynamoDBModel: 'silo' | 'pool';
  sharedTableName?: string; // For pool model
}

export class TenantDynamoDBStack extends Stack {
  public readonly tenantRole: iam.Role;
  public readonly tableName?: string;

  constructor(scope: Construct, id: string, props: TenantDynamoDBStackProps) {
    super(scope, id, props);

    const { tenantId, dynamoDBModel, sharedTableName } = props;

    // Create the tenant-specific IAM role
    this.tenantRole = new iam.Role(this, `TenantRole-${tenantId}`, {
      roleName: `GaiXer-Tenant-${tenantId}-DynamoDB-Role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `DynamoDB access role for tenant ${tenantId} in GaiXer application`,
    });

    // Add basic Lambda execution permissions
    this.tenantRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    if (dynamoDBModel === 'silo') {
      // Create dedicated DynamoDB table for this tenant
      const table = new dynamodb.Table(this, `TenantTable-${tenantId}`, {
        tableName: `GaiXer-Tenant-${tenantId}-Table`,
        partitionKey: {
          name: 'id',
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.DESTROY, // For demo purposes
      });

      this.tableName = table.tableName;

      // Grant full access to the tenant's dedicated table
      table.grantReadWriteData(this.tenantRole);

      // Output the table name
      new CfnOutput(this, 'TenantTableName', {
        value: table.tableName,
        description: `DynamoDB table name for tenant ${tenantId}`,
        exportName: `TenantTable-${tenantId}-Name`,
      });
    } else {
      // Pool model: Grant access to shared table with tenant-specific conditions
      const tableArn = sharedTableName 
        ? `arn:aws:dynamodb:${this.region}:${this.account}:table/${sharedTableName}`
        : `arn:aws:dynamodb:${this.region}:${this.account}:table/GaiXer-SharedTenantTable`;

      // Add fine-grained permissions for pool model
      this.tenantRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
          ],
          resources: [tableArn, `${tableArn}/index/*`],
          conditions: {
            'ForAllValues:StringEquals': {
              'dynamodb:LeadingKeys': [tenantId],
            },
          },
        })
      );

      // Allow Query operations with tenant ID condition
      this.tenantRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['dynamodb:Query'],
          resources: [tableArn, `${tableArn}/index/*`],
          conditions: {
            'ForAllValues:StringEquals': {
              'dynamodb:Select': 'SpecificAttributes',
            },
          },
        })
      );

      // Output info about shared table access
      new CfnOutput(this, 'SharedTableInfo', {
        value: `Tenant ${tenantId} uses shared table with partition key isolation`,
        description: `DynamoDB access model for tenant ${tenantId}`,
      });
    }

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

    // Output the DynamoDB model type
    new CfnOutput(this, 'DynamoDBModel', {
      value: dynamoDBModel,
      description: `DynamoDB model type for tenant ${tenantId}`,
      exportName: `Tenant-${tenantId}-DynamoDBModel`,
    });
  }
}