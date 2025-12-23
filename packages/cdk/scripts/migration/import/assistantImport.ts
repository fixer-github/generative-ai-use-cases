#!/usr/bin/env node

/**
 * Assistant Import Script
 * 変換済みの Assistant データを DynamoDB に投入
 */

import {
  DynamoDBClient,
  BatchWriteItemCommand,
  DescribeTableCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface AssistantItem {
  id: string;
  createdDate: string;
  assistantId: string;
  userId: string;
  tenantId: string;
  name: string;
  description: string;
  instruction: string;
  modelId: string;
  ragEnabled: boolean;
  visibility: 'private' | 'public';
  syncStatus: string;
  syncStatusReason: string;
  knowledgeSources: unknown[];
  firstQuestions?: string[];
  s3Urls?: string[];
  updatedDate: string;
}

interface ImportResult {
  success: boolean;
  assistantId: string;
  error?: string;
}

interface ImportStatistics {
  total: number;
  success: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface CliOptions {
  inputFile: string;
  tableName: string;
  region: string;
  profile?: string;
  dryRun: boolean;
  skipExisting: boolean;
}

// ============================================================================
// DynamoDB Operations
// ============================================================================

/**
 * DynamoDB クライアントを作成
 */
function createDynamoDBClient(
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
async function tableExists(
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
async function getExistingAssistantIds(
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
          | Record<string, { S?: string; N?: string }>
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
async function importAssistants(
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

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Partial<CliOptions> = {
    dryRun: false,
    skipExisting: true,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-i':
      case '--input':
        options.inputFile = args[++i];
        break;
      case '-t':
      case '--table':
        options.tableName = args[++i];
        break;
      case '-r':
      case '--region':
        options.region = args[++i];
        break;
      case '-p':
      case '--profile':
        options.profile = args[++i];
        break;
      case '-d':
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--no-skip-existing':
        options.skipExisting = false;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  if (!options.inputFile || !options.tableName || !options.region) {
    console.error('Error: Missing required arguments');
    printHelp();
    process.exit(1);
  }

  return options as CliOptions;
}

function printHelp(): void {
  console.log(`
Assistant Import Script

Usage:
  npx ts-node import/assistantImport.ts [options]

Options:
  -i, --input <path>       Input JSON file (assistants.json from transform)
  -t, --table <name>       DynamoDB table name
  -r, --region <region>    AWS region
  -p, --profile <profile>  AWS profile (optional)
  -d, --dry-run            Dry run mode (no actual write)
  --no-skip-existing       Don't skip existing assistants (may cause duplicates)
  -h, --help               Show help

Example:
  npx ts-node import/assistantImport.ts \\
    -i ./output/assistants.json \\
    -t GenU-Assistant-prod-tenant-abc123 \\
    -r ap-northeast-1 \\
    -p my-profile \\
    -d
`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('=== Assistant Import ===');
  console.log(`Input File: ${options.inputFile}`);
  console.log(`Table Name: ${options.tableName}`);
  console.log(`Region: ${options.region}`);
  console.log(`Profile: ${options.profile || '(default)'}`);
  console.log(`Dry Run: ${options.dryRun}`);
  console.log(`Skip Existing: ${options.skipExisting}`);

  // 入力ファイルを読み込み
  const assistants: AssistantItem[] = JSON.parse(
    fs.readFileSync(options.inputFile, 'utf-8')
  );

  console.log(`\nFound ${assistants.length} assistants in input file`);

  if (assistants.length === 0) {
    console.log('No assistants to import. Exiting.');
    return;
  }

  // DynamoDB クライアント作成
  const client = createDynamoDBClient(options.region, options.profile);

  // テーブル存在確認
  const exists = await tableExists(client, options.tableName);
  if (!exists) {
    console.error(`Error: Table "${options.tableName}" does not exist`);
    process.exit(1);
  }

  // インポート実行
  console.log('\nStarting import...\n');
  const stats = await importAssistants(
    client,
    options.tableName,
    assistants,
    options.dryRun,
    options.skipExisting
  );

  // 結果を保存
  const outputDir = path.dirname(options.inputFile);
  const statsPath = path.join(outputDir, 'import-stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));

  // 統計を表示
  console.log('\n=== Import Statistics ===');
  console.log(`Total: ${stats.total}`);
  console.log(`Success: ${stats.success}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Failed: ${stats.failed}`);

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more`);
    }
  }

  console.log(`\nStatistics saved to: ${statsPath}`);

  if (stats.failed > 0) {
    console.log('\nImport completed with errors!');
    process.exit(1);
  } else {
    console.log('\nImport completed successfully!');
  }
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
