import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Key, KeyUsage, KeySpec } from 'aws-cdk-lib/aws-kms';
import {
  PolicyStatement,
  Effect,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

export interface TenantManagerProps {
  readonly environment: string;
}

export class TenantManager extends Construct {
  public readonly tenantsTable: Table;
  public readonly kmsKey: Key;
  public readonly tenantManagerFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: TenantManagerProps) {
    super(scope, id);

    // DynamoDB Tenants table
    this.tenantsTable = new Table(this, 'TenantsTable', {
      tableName: `Tenants-${props.environment}`,
      partitionKey: {
        name: 'tenantId',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: 'AWS_MANAGED',
      pointInTimeRecovery: true,
      // Retain table in production for data safety
      removalPolicy: props.environment === 'prod' 
        ? 'RETAIN' 
        : 'DESTROY',
    });

    // KMS Key for tenant data encryption (Phase 2)
    this.kmsKey = new Key(this, 'TenantsKmsKey', {
      alias: `TenantsKey-${props.environment}`,
      description: 'KMS key for tenant cross-account role ARN encryption',
      enableKeyRotation: true,
      // Retain key in production for data safety
      removalPolicy: props.environment === 'prod' 
        ? 'RETAIN' 
        : 'DESTROY',
    });

    // Grant permissions to Lambda service
    this.kmsKey.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal('lambda.amazonaws.com')],
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'kms:ViaService': `dynamodb.${this.stack.region}.amazonaws.com`,
          },
        },
      })
    );

    // TenantManager Lambda function
    this.tenantManagerFunction = new NodejsFunction(this, 'TenantManagerFunction', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/tenantManager.ts',
      handler: 'handler',
      timeout: Duration.minutes(5),
      environment: {
        TENANTS_TABLE_NAME: this.tenantsTable.tableName,
        TENANTS_KMS_KEY_ID: this.kmsKey.keyId,
      },
      bundling: {
        nodeModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/client-kms',
          '@aws-sdk/util-dynamodb',
        ],
      },
    });

    // Grant Lambda permissions to access DynamoDB table
    this.tenantsTable.grantReadWriteData(this.tenantManagerFunction);

    // Grant Lambda permissions to use KMS key
    this.kmsKey.grantEncryptDecrypt(this.tenantManagerFunction);

    // Add additional KMS permissions for key management operations
    this.tenantManagerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'kms:CreateGrant',
          'kms:DescribeKey',
          'kms:GenerateDataKey*',
        ],
        resources: [this.kmsKey.keyArn],
      })
    );
  }
}