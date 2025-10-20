import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, ProjectionType, StreamViewType, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { PlanQuotaStoreProps } from 'generative-ai-use-cases';

/**
 * Plan and Quota Store Construct
 * プラン・クォータストアコンストラクト
 *
 * Creates DynamoDB tables for managing:
 * - Plans (subscription tiers and permissions)
 * - Tenant plan assignments
 * - Usage tracking and quotas
 */
export class PlanQuotaStore extends Construct {
  /** Plans table - stores plan definitions */
  public readonly plansTable: Table;

  /** Tenant plans table - stores tenant-to-plan assignments */
  public readonly tenantPlansTable: Table;

  /** Usage table - stores usage counters and quotas */
  public readonly usageTable: Table;

  constructor(scope: Construct, id: string, props?: PlanQuotaStoreProps) {
    super(scope, id);

    // ========================================================================
    // Plans Table - Plan definitions and permissions
    // ========================================================================
    this.plansTable = new Table(this, 'PlansTable', {
      partitionKey: {
        name: 'plan_id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: props?.pointInTimeRecovery ?? true,
      stream: props?.stream ? StreamViewType.NEW_AND_OLD_IMAGES : undefined,
      removalPolicy: RemovalPolicy.RETAIN, // Protect plan data
      tableName: `GenAI-Plans`,
    });

    // ========================================================================
    // Tenant Plans Table - Tenant-to-plan assignments
    // ========================================================================
    this.tenantPlansTable = new Table(this, 'TenantPlansTable', {
      partitionKey: {
        name: 'tenant_id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: props?.pointInTimeRecovery ?? true,
      stream: props?.stream ? StreamViewType.NEW_AND_OLD_IMAGES : undefined,
      removalPolicy: RemovalPolicy.RETAIN,
      tableName: `GenAI-TenantPlans`,
    });

    // GSI for querying by plan_id (useful for finding all tenants on a plan)
    this.tenantPlansTable.addGlobalSecondaryIndex({
      indexName: 'plan_id-index',
      partitionKey: {
        name: 'plan_id',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // GSI for querying by Stripe subscription ID
    this.tenantPlansTable.addGlobalSecondaryIndex({
      indexName: 'stripe_subscription_id-index',
      partitionKey: {
        name: 'stripe_subscription_id',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // GSI for querying by status
    this.tenantPlansTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: {
        name: 'status',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'start_date',
        type: AttributeType.NUMBER,
      },
      projectionType: ProjectionType.ALL,
    });

    // ========================================================================
    // Usage Table - Usage counters and quota tracking
    // ========================================================================
    this.usageTable = new Table(this, 'UsageTable', {
      partitionKey: {
        name: 'pk', // Format: {tenant_id}#{resource_type}
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // Format: {date}#{model}
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: props?.pointInTimeRecovery ?? false, // Usage data can be regenerated
      stream: props?.stream ? StreamViewType.NEW_AND_OLD_IMAGES : undefined,
      removalPolicy: RemovalPolicy.DESTROY, // Usage data is temporary
      tableName: `GenAI-Usage`,
      timeToLiveAttribute: props?.ttlAttributeName || 'ttl', // Auto-delete old records
    });

    // GSI for querying usage by tenant and date range
    this.usageTable.addGlobalSecondaryIndex({
      indexName: 'tenant_id-date-index',
      partitionKey: {
        name: 'tenant_id',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'date',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // GSI for querying usage by model (useful for cost analysis)
    this.usageTable.addGlobalSecondaryIndex({
      indexName: 'model-index',
      partitionKey: {
        name: 'model',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'date',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // GSI for querying usage by plan (useful for plan analytics)
    this.usageTable.addGlobalSecondaryIndex({
      indexName: 'plan_id-date-index',
      partitionKey: {
        name: 'plan_id',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'date',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });
  }

  /**
   * Grant read access to all tables
   */
  grantRead(grantee: IGrantable) {
    this.plansTable.grantReadData(grantee);
    this.tenantPlansTable.grantReadData(grantee);
    this.usageTable.grantReadData(grantee);
  }

  /**
   * Grant write access to all tables
   */
  grantWrite(grantee: IGrantable) {
    this.plansTable.grantWriteData(grantee);
    this.tenantPlansTable.grantWriteData(grantee);
    this.usageTable.grantWriteData(grantee);
  }

  /**
   * Grant full access to all tables
   */
  grantFullAccess(grantee: IGrantable) {
    this.plansTable.grantFullAccess(grantee);
    this.tenantPlansTable.grantFullAccess(grantee);
    this.usageTable.grantFullAccess(grantee);
  }

  /**
   * Grant read-only access to plans (for Lambda Authorizer)
   */
  grantPlansRead(grantee: IGrantable) {
    this.plansTable.grantReadData(grantee);
    this.tenantPlansTable.grantReadData(grantee);
  }

  /**
   * Grant usage tracking access (read plans + write usage)
   */
  grantUsageTracking(grantee: IGrantable) {
    this.plansTable.grantReadData(grantee);
    this.tenantPlansTable.grantReadData(grantee);
    this.usageTable.grantReadWriteData(grantee);
  }
}
