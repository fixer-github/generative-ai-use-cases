import { Construct } from 'constructs';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
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
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      // Retain table in production for data safety
      removalPolicy: props.environment === 'prod' 
        ? RemovalPolicy.RETAIN 
        : RemovalPolicy.DESTROY,
    });

    // KMS Key for tenant data encryption (Phase 2)
    this.kmsKey = new Key(this, 'TenantsKmsKey', {
      alias: `TenantsKey-${props.environment}`,
      description: 'KMS key for tenant cross-account role ARN encryption',
      enableKeyRotation: true,
      // Retain key in production for data safety
      removalPolicy: props.environment === 'prod' 
        ? RemovalPolicy.RETAIN 
        : RemovalPolicy.DESTROY,
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
            'kms:ViaService': `dynamodb.${Stack.of(this).region}.amazonaws.com`,
          },
        },
      })
    );

  }
}