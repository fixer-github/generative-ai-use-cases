import { Construct } from 'constructs';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';

export class Database extends Construct {
  public readonly table: ddb.Table;
  public readonly statsTable: ddb.Table;
  public readonly assistantTable: ddb.Table;
  public readonly assistantMessagesTable: ddb.Table;
  public readonly feedbackIndexName: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

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
    });

    // Assistant table
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
      removalPolicy: RemovalPolicy.DESTROY,
      stream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    assistantTable.addGlobalSecondaryIndex({
      indexName: 'AssistantIdIndex',
      partitionKey: {
        name: 'assistantId',
        type: ddb.AttributeType.STRING,
      },
    });

    // Assistant Messages table
    const assistantMessagesTable = new ddb.Table(this, 'AssistantMessagesTable', {
      partitionKey: {
        name: 'assistantId',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'messageId',
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    this.table = table;
    this.statsTable = statsTable;
    this.assistantTable = assistantTable;
    this.assistantMessagesTable = assistantMessagesTable;
    this.feedbackIndexName = feedbackIndexName;
  }
}
