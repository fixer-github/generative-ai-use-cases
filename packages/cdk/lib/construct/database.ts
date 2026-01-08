import { Construct } from 'constructs';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';

export interface DatabaseProps {
  readonly summaryJobEnabled?: boolean;
}

export class Database extends Construct {
  public readonly table: ddb.Table;
  public readonly statsTable: ddb.Table;
  public readonly userSummaryTable?: ddb.Table;
  public readonly feedbackIndexName: string;
  public readonly assistantTable: ddb.Table;
  public readonly assistantIdIndexName: string;
  public readonly tenantVisibilityIndexName: string;

  constructor(scope: Construct, id: string, props?: DatabaseProps) {
    super(scope, id);

    const { summaryJobEnabled = false } = props || {};

    const feedbackIndexName = 'FeedbackIndex';
    const table = new ddb.Table(this, 'Table', {
      partitionKey: {
        name: 'id',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdDate',
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      encryption: ddb.TableEncryption.AWS_MANAGED,
    });

    table.addGlobalSecondaryIndex({
      indexName: feedbackIndexName,
      partitionKey: {
        name: 'feedback',
        type: ddb.AttributeType.STRING,
      },
    });

    // Stats table for token usage statistics
    const statsTable = new ddb.Table(this, 'StatsTable', {
      partitionKey: {
        name: 'id',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'userId',
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      encryption: ddb.TableEncryption.AWS_MANAGED,
    });

    // User Summary table for storing daily and user summaries (only when feature enabled)
    let userSummaryTable: ddb.Table | undefined;
    if (summaryJobEnabled) {
      userSummaryTable = new ddb.Table(this, 'UserSummaryTable', {
        partitionKey: {
          name: 'id',
          type: ddb.AttributeType.STRING,
        },
        sortKey: {
          name: 'createdDate',
          type: ddb.AttributeType.STRING,
        },
        billingMode: ddb.BillingMode.PAY_PER_REQUEST,
        encryption: ddb.TableEncryption.AWS_MANAGED,
      });

      userSummaryTable.addGlobalSecondaryIndex({
        indexName: 'DateIndex',
        partitionKey: {
          name: 'date',
          type: ddb.AttributeType.STRING,
        },
        sortKey: {
          name: 'userId',
          type: ddb.AttributeType.STRING,
        },
        projectionType: ddb.ProjectionType.ALL,
      });
    }

    // Assistant table for storing assistant configurations
    const assistantIdIndexName = 'AssistantIdIndex';
    const tenantVisibilityIndexName = 'TenantVisibilityIndex';
    const assistantTable = new ddb.Table(this, 'AssistantTable', {
      partitionKey: {
        name: 'userId',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdDate',
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      encryption: ddb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
    });

    assistantTable.addGlobalSecondaryIndex({
      indexName: assistantIdIndexName,
      partitionKey: {
        name: 'assistantId',
        type: ddb.AttributeType.STRING,
      },
      projectionType: ddb.ProjectionType.ALL,
    });

    assistantTable.addGlobalSecondaryIndex({
      indexName: tenantVisibilityIndexName,
      partitionKey: {
        name: 'tenantId',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdDate',
        type: ddb.AttributeType.STRING,
      },
      projectionType: ddb.ProjectionType.ALL,
    });

    this.table = table;
    this.statsTable = statsTable;
    this.userSummaryTable = userSummaryTable;
    this.feedbackIndexName = feedbackIndexName;
    this.assistantTable = assistantTable;
    this.assistantIdIndexName = assistantIdIndexName;
    this.tenantVisibilityIndexName = tenantVisibilityIndexName;
  }
}
