/**
 * Assistant Import
 * 変換済みの Assistant データを DynamoDB に投入
 */

import {
  DynamoDBClient,
  BatchWriteItemCommand,
  DescribeTableCommand,
  ScanCommand,
  AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import { AssistantItem, ImportStatistics } from '../types';

// ============================================================================
// DynamoDB Operations
// ============================================================================

/**
 * DynamoDB クライアントを作成
 */
export function createDynamoDBClient(
  region: string,
  profile?: string
): DynamoDBClient {
  const config: {
    region: string;
    credentials?: ReturnType<typeof fromIni>;
  } = { region };

  if (profile) {
    config.credentials = fromIni({ profile });
  }

  return new DynamoDBClient(config);
}

/**
 * テーブルの存在確認
 */
export async function tableExists(
  client: DynamoDBClient,
  tableName: string
): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 既存の assistantId を取得
 */
export async function getExistingAssistantIds(
  client: DynamoDBClient,
  tableName: string
): Promise<Set<string>> {
  const ids = new Set<string>();
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const response = await client.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: 'assistantId',
        ExclusiveStartKey: lastEvaluatedKey as
          | Record<string, AttributeValue>
          | undefined,
      })
    );

    if (response.Items) {
      for (const item of response.Items) {
        if (item.assistantId?.S) {
          ids.add(item.assistantId.S);
        }
      }
    }

    lastEvaluatedKey = response.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);

  return ids;
}

/**
 * バッチで Assistant を投入
 */
export async function importAssistants(
  client: DynamoDBClient,
  tableName: string,
  assistants: AssistantItem[],
  dryRun: boolean,
  skipExisting: boolean
): Promise<ImportStatistics> {
  const stats: ImportStatistics = {
    total: assistants.length,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // 既存の assistantId を取得
  let existingIds = new Set<string>();
  if (skipExisting) {
    console.log('Fetching existing assistant IDs...');
    existingIds = await getExistingAssistantIds(client, tableName);
    console.log(`Found ${existingIds.size} existing assistants`);
  }

  // 重複を除外
  const toImport = assistants.filter((a) => {
    if (existingIds.has(a.assistantId)) {
      stats.skipped++;
      console.log(`  Skipped (exists): ${a.assistantId} - ${a.name}`);
      return false;
    }
    return true;
  });

  if (toImport.length === 0) {
    console.log('No new assistants to import.');
    return stats;
  }

  console.log(`Importing ${toImport.length} new assistants...`);

  // DynamoDB BatchWriteItem は最大25アイテム
  const batchSize = 25;

  for (let i = 0; i < toImport.length; i += batchSize) {
    const batch = toImport.slice(i, i + batchSize);

    const putRequests = batch.map((assistant) => ({
      PutRequest: {
        Item: marshall(assistant, {
          removeUndefinedValues: true,
          convertEmptyValues: true,
        }),
      },
    }));

    if (dryRun) {
      console.log(`[DRY-RUN] Would write ${batch.length} items`);
      for (const a of batch) {
        console.log(`  - ${a.assistantId}: ${a.name}`);
      }
      stats.success += batch.length;
      continue;
    }

    try {
      const response = await client.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [tableName]: putRequests,
          },
        })
      );

      // 未処理アイテムの確認
      const unprocessed =
        response.UnprocessedItems?.[tableName]?.length || 0;
      const processed = batch.length - unprocessed;

      stats.success += processed;

      if (unprocessed > 0) {
        stats.failed += unprocessed;
        stats.errors.push(
          `Batch ${i / batchSize + 1}: ${unprocessed} items unprocessed`
        );
      }

      for (const a of batch.slice(0, processed)) {
        console.log(`  Imported: ${a.assistantId} - ${a.name}`);
      }
    } catch (error) {
      stats.failed += batch.length;
      const errorMsg = `Batch ${i / batchSize + 1} failed: ${error}`;
      stats.errors.push(errorMsg);
      console.error(`  ${errorMsg}`);
    }

    // 進捗表示
    const processed = Math.min(i + batchSize, toImport.length);
    console.log(`Progress: ${processed}/${toImport.length}`);
  }

  return stats;
}
