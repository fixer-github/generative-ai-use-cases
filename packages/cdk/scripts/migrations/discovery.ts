import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

export type DynamoDBTableInfo = {
  tableName: string;
  itemCount: number;
  sizeBytes: number;
  partitionKey: string;
  sortKey?: string;
};

export type S3BucketInfo = {
  bucketName: string;
  creationDate?: Date;
};

export type OpenSearchDomainInfo = {
  domainName: string;
};

export type DiscoveryReport = {
  region: string;
  timestamp: string;
  dynamodbTables: DynamoDBTableInfo[];
  s3Buckets: S3BucketInfo[];
  opensearchDomains: OpenSearchDomainInfo[];
  oldBotTable?: DynamoDBTableInfo;
  oldConversationTable?: DynamoDBTableInfo;
  knowledgeBaseBuckets: S3BucketInfo[];
  largeMessageBuckets: S3BucketInfo[];
};

export type DiscoveryOptions = {
  region: string;
  tablePrefix?: string;
  botTablePattern?: RegExp;
  conversationTablePattern?: RegExp;
  knowledgeBucketPattern?: RegExp;
  largeMessageBucketPattern?: RegExp;
};

export class ResourceDiscovery {
  private dynamoClient: DynamoDBClient;
  private s3Client: S3Client;

  constructor(private options: DiscoveryOptions) {
    this.dynamoClient = new DynamoDBClient({ region: options.region });
    this.s3Client = new S3Client({ region: options.region });
  }

  async discoverDynamoDBTables(): Promise<DynamoDBTableInfo[]> {
    const tables: DynamoDBTableInfo[] = [];
    let lastEvaluatedTableName: string | undefined = undefined;

    // Paginate through all tables
    do {
      const listCommand = new ListTablesCommand({
        ExclusiveStartTableName: lastEvaluatedTableName,
      });
      const response = await this.dynamoClient.send(listCommand);

      if (!response.TableNames) {
        break;
      }

      for (const tableName of response.TableNames) {
        if (
          this.options.tablePrefix &&
          !tableName.startsWith(this.options.tablePrefix)
        ) {
          continue;
        }

        const describeCommand = new DescribeTableCommand({ TableName: tableName });
        const tableInfo = await this.dynamoClient.send(describeCommand);

        if (!tableInfo.Table) {
          continue;
        }

        const partitionKey =
          tableInfo.Table.KeySchema?.find((k) => k.KeyType === 'HASH')
            ?.AttributeName || '';
        const sortKey = tableInfo.Table.KeySchema?.find(
          (k) => k.KeyType === 'RANGE'
        )?.AttributeName;

        tables.push({
          tableName,
          itemCount: tableInfo.Table.ItemCount || 0,
          sizeBytes: tableInfo.Table.TableSizeBytes || 0,
          partitionKey,
          sortKey,
        });
      }

      lastEvaluatedTableName = response.LastEvaluatedTableName;
    } while (lastEvaluatedTableName);

    return tables;
  }

  async discoverS3Buckets(): Promise<S3BucketInfo[]> {
    const buckets: S3BucketInfo[] = [];
    const listCommand = new ListBucketsCommand({});
    const response = await this.s3Client.send(listCommand);

    if (!response.Buckets) {
      return buckets;
    }

    for (const bucket of response.Buckets) {
      if (bucket.Name) {
        buckets.push({
          bucketName: bucket.Name,
          creationDate: bucket.CreationDate,
        });
      }
    }

    return buckets;
  }

  async discoverOpenSearchDomains(): Promise<OpenSearchDomainInfo[]> {
    const domains: OpenSearchDomainInfo[] = [];
    // OpenSearch discovery is optional and not critical for migration
    // Users can manually identify OpenSearch domains if needed
    console.log(
      'OpenSearch discovery skipped. Use AWS Console to identify domains if needed.'
    );
    return domains;
  }

  identifyOldBotTable(tables: DynamoDBTableInfo[]): DynamoDBTableInfo | undefined {
    const pattern =
      this.options.botTablePattern || /bot|custom-bot|bedrock-chat.*bot/i;

    return tables.find((table) => {
      if (!pattern.test(table.tableName)) {
        return false;
      }
      // Bot table has PK as user_id and SK contains "#bot"
      return table.partitionKey && table.sortKey;
    });
  }

  identifyOldConversationTable(
    tables: DynamoDBTableInfo[]
  ): DynamoDBTableInfo | undefined {
    const pattern =
      this.options.conversationTablePattern ||
      /conversation|chat|bedrock-chat.*conversation/i;

    return tables.find((table) => {
      if (!pattern.test(table.tableName)) {
        return false;
      }
      // Conversation table has PK as user_id and SK contains "#CONV#"
      return table.partitionKey && table.sortKey;
    });
  }

  identifyKnowledgeBaseBuckets(buckets: S3BucketInfo[]): S3BucketInfo[] {
    const pattern =
      this.options.knowledgeBucketPattern || /knowledge|rag|docs|documents/i;

    return buckets.filter((bucket) => pattern.test(bucket.bucketName));
  }

  identifyLargeMessageBuckets(buckets: S3BucketInfo[]): S3BucketInfo[] {
    const pattern =
      this.options.largeMessageBucketPattern ||
      /message|conversation|chat|large/i;

    return buckets.filter((bucket) => pattern.test(bucket.bucketName));
  }

  async generateReport(): Promise<DiscoveryReport> {
    console.log('Discovering DynamoDB tables...');
    const tables = await this.discoverDynamoDBTables();

    console.log('Discovering S3 buckets...');
    const buckets = await this.discoverS3Buckets();

    console.log('Discovering OpenSearch domains...');
    const domains = await this.discoverOpenSearchDomains();

    console.log('Identifying old bot table...');
    const oldBotTable = this.identifyOldBotTable(tables);

    console.log('Identifying old conversation table...');
    const oldConversationTable = this.identifyOldConversationTable(tables);

    console.log('Identifying knowledge base buckets...');
    const knowledgeBaseBuckets = this.identifyKnowledgeBaseBuckets(buckets);

    console.log('Identifying large message buckets...');
    const largeMessageBuckets = this.identifyLargeMessageBuckets(buckets);

    return {
      region: this.options.region,
      timestamp: new Date().toISOString(),
      dynamodbTables: tables,
      s3Buckets: buckets,
      opensearchDomains: domains,
      oldBotTable,
      oldConversationTable,
      knowledgeBaseBuckets,
      largeMessageBuckets,
    };
  }

  printReport(report: DiscoveryReport): void {
    console.log('\n=== Migration Resource Discovery Report ===\n');
    console.log(`Region: ${report.region}`);
    console.log(`Timestamp: ${report.timestamp}\n`);

    console.log(`Found ${report.dynamodbTables.length} DynamoDB tables`);
    if (report.oldBotTable) {
      console.log(
        `  Old Bot Table: ${report.oldBotTable.tableName} (${report.oldBotTable.itemCount} items, ${(report.oldBotTable.sizeBytes / 1024 / 1024).toFixed(2)} MB)`
      );
    } else {
      console.log('  Old Bot Table: NOT FOUND');
    }

    if (report.oldConversationTable) {
      console.log(
        `  Old Conversation Table: ${report.oldConversationTable.tableName} (${report.oldConversationTable.itemCount} items, ${(report.oldConversationTable.sizeBytes / 1024 / 1024).toFixed(2)} MB)`
      );
    } else {
      console.log('  Old Conversation Table: NOT FOUND');
    }

    console.log(`\nFound ${report.s3Buckets.length} S3 buckets`);
    console.log(
      `  Knowledge Base Buckets: ${report.knowledgeBaseBuckets.length}`
    );
    report.knowledgeBaseBuckets.forEach((bucket) => {
      console.log(`    - ${bucket.bucketName}`);
    });

    console.log(
      `  Large Message Buckets: ${report.largeMessageBuckets.length}`
    );
    report.largeMessageBuckets.forEach((bucket) => {
      console.log(`    - ${bucket.bucketName}`);
    });

    console.log(`\nFound ${report.opensearchDomains.length} OpenSearch domains`);
    report.opensearchDomains.forEach((domain) => {
      console.log(`  - ${domain.domainName}`);
    });

    console.log('\n===========================================\n');
  }
}
