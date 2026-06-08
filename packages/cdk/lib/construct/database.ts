import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import {
  BACKUP_PROTECTED_TAG,
  BACKUP_PROTECTED_METADATA_KEY,
  BACKUP_PROTECTED_METADATA_VALUE,
} from '../aspect/deletion-policy-setter';

export class Database extends Construct {
  public readonly table: ddb.Table;
  public readonly statsTable: ddb.Table;
  public readonly agentObservabilityTable: ddb.Table;
  public readonly meetingTable: ddb.Table;
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
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    table.node.addMetadata(
      BACKUP_PROTECTED_METADATA_KEY,
      BACKUP_PROTECTED_METADATA_VALUE
    );
    cdk.Tags.of(table).add(
      BACKUP_PROTECTED_TAG.key,
      BACKUP_PROTECTED_TAG.value
    );

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
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    statsTable.node.addMetadata(
      BACKUP_PROTECTED_METADATA_KEY,
      BACKUP_PROTECTED_METADATA_VALUE
    );
    cdk.Tags.of(statsTable).add(
      BACKUP_PROTECTED_TAG.key,
      BACKUP_PROTECTED_TAG.value
    );

    const agentObservabilityTable = new ddb.Table(
      this,
      'AgentObservabilityTable',
      {
        partitionKey: {
          name: 'agent_run_id',
          type: ddb.AttributeType.STRING,
        },
        sortKey: {
          name: 'sk',
          type: ddb.AttributeType.STRING,
        },
        billingMode: ddb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
        deletionProtection: true,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      }
    );
    agentObservabilityTable.node.addMetadata(
      BACKUP_PROTECTED_METADATA_KEY,
      BACKUP_PROTECTED_METADATA_VALUE
    );
    cdk.Tags.of(agentObservabilityTable).add(
      BACKUP_PROTECTED_TAG.key,
      BACKUP_PROTECTED_TAG.value
    );

    // Meeting (minutes) entity table — the source of truth for the meeting
    // workbench. Kept physically separate from the main table so capacity,
    // backup and blast radius are isolated from Chat. The main table only
    // holds a lightweight projection row for sidebar history. See the
    // Phase 2 meeting-workbench design memo, section 1.2.
    const meetingTable = new ddb.Table(this, 'MeetingTable', {
      partitionKey: {
        name: 'id',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdDate',
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    meetingTable.node.addMetadata(
      BACKUP_PROTECTED_METADATA_KEY,
      BACKUP_PROTECTED_METADATA_VALUE
    );
    cdk.Tags.of(meetingTable).add(
      BACKUP_PROTECTED_TAG.key,
      BACKUP_PROTECTED_TAG.value
    );

    agentObservabilityTable.addGlobalSecondaryIndex({
      indexName: 'AgentIdIndex',
      partitionKey: {
        name: 'GSI1PK',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI1SK',
        type: ddb.AttributeType.STRING,
      },
    });

    this.table = table;
    this.statsTable = statsTable;
    this.agentObservabilityTable = agentObservabilityTable;
    this.meetingTable = meetingTable;
    this.feedbackIndexName = feedbackIndexName;
  }
}
