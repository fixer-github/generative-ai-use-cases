#!/usr/bin/env node

/**
 * S3 File Copy Script
 * v0.5.3 の S3 パス構造から develop のパス構造にファイルをコピー
 */

import {
  S3Client,
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface S3CopyMapping {
  sourceKey: string;
  targetKey: string;
  fileName: string;
  fileId: string;
  botId: string;
  userId: string;
}

interface CopyResult {
  success: boolean;
  sourceKey: string;
  targetKey: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

interface CopyStatistics {
  total: number;
  success: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface CliOptions {
  mappingFile: string;
  sourceBucket: string;
  targetBucket: string;
  region: string;
  profile?: string;
  dryRun: boolean;
  concurrency: number;
}

// ============================================================================
// S3 Operations
// ============================================================================

/**
 * S3 クライアントを作成
 */
function createS3Client(region: string, profile?: string): S3Client {
  const config: { region: string; credentials?: ReturnType<typeof fromIni> } = {
    region,
  };

  if (profile) {
    config.credentials = fromIni({ profile });
  }

  return new S3Client(config);
}

/**
 * オブジェクトの存在確認
 */
async function objectExists(
  client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 単一ファイルをコピー
 */
async function copyObject(
  client: S3Client,
  sourceBucket: string,
  targetBucket: string,
  mapping: S3CopyMapping,
  dryRun: boolean
): Promise<CopyResult> {
  const { sourceKey, targetKey } = mapping;

  try {
    // ソースの存在確認
    const sourceExists = await objectExists(client, sourceBucket, sourceKey);
    if (!sourceExists) {
      return {
        success: false,
        sourceKey,
        targetKey,
        skipped: true,
        skipReason: 'Source file not found',
      };
    }

    // ターゲットの存在確認（既存の場合はスキップ）
    const targetExists = await objectExists(client, targetBucket, targetKey);
    if (targetExists) {
      return {
        success: true,
        sourceKey,
        targetKey,
        skipped: true,
        skipReason: 'Target file already exists',
      };
    }

    if (dryRun) {
      console.log(`[DRY-RUN] Would copy: ${sourceKey} -> ${targetKey}`);
      return {
        success: true,
        sourceKey,
        targetKey,
        skipped: true,
        skipReason: 'Dry run',
      };
    }

    // コピー実行
    await client.send(
      new CopyObjectCommand({
        Bucket: targetBucket,
        Key: targetKey,
        CopySource: encodeURIComponent(`${sourceBucket}/${sourceKey}`),
      })
    );

    return {
      success: true,
      sourceKey,
      targetKey,
    };
  } catch (error) {
    return {
      success: false,
      sourceKey,
      targetKey,
      error: String(error),
    };
  }
}

/**
 * バッチでファイルをコピー
 */
async function copyFiles(
  client: S3Client,
  sourceBucket: string,
  targetBucket: string,
  mappings: S3CopyMapping[],
  dryRun: boolean,
  concurrency: number
): Promise<CopyStatistics> {
  const stats: CopyStatistics = {
    total: mappings.length,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // バッチ処理
  for (let i = 0; i < mappings.length; i += concurrency) {
    const batch = mappings.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((mapping) =>
        copyObject(client, sourceBucket, targetBucket, mapping, dryRun)
      )
    );

    for (const result of results) {
      if (result.success) {
        if (result.skipped) {
          stats.skipped++;
          if (result.skipReason !== 'Dry run') {
            console.log(
              `  Skipped: ${result.sourceKey} (${result.skipReason})`
            );
          }
        } else {
          stats.success++;
          console.log(`  Copied: ${result.sourceKey} -> ${result.targetKey}`);
        }
      } else {
        stats.failed++;
        const errorMsg = `Failed: ${result.sourceKey} - ${result.error}`;
        stats.errors.push(errorMsg);
        console.error(`  ${errorMsg}`);
      }
    }

    // 進捗表示
    const processed = Math.min(i + concurrency, mappings.length);
    console.log(`Progress: ${processed}/${mappings.length}`);
  }

  return stats;
}

/**
 * バケット内の全ファイルを一覧取得
 */
async function listAllObjects(
  client: S3Client,
  bucket: string,
  prefix?: string
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) {
          keys.push(obj.Key);
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Partial<CliOptions> = {
    dryRun: false,
    concurrency: 10,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-m':
      case '--mapping':
        options.mappingFile = args[++i];
        break;
      case '-s':
      case '--source-bucket':
        options.sourceBucket = args[++i];
        break;
      case '-t':
      case '--target-bucket':
        options.targetBucket = args[++i];
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
      case '-c':
      case '--concurrency':
        options.concurrency = parseInt(args[++i], 10);
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  if (
    !options.mappingFile ||
    !options.sourceBucket ||
    !options.targetBucket ||
    !options.region
  ) {
    console.error('Error: Missing required arguments');
    printHelp();
    process.exit(1);
  }

  return options as CliOptions;
}

function printHelp(): void {
  console.log(`
S3 File Copy Script

Usage:
  npx ts-node import/s3Copy.ts [options]

Options:
  -m, --mapping <path>         S3 mappings JSON file (from transform step)
  -s, --source-bucket <name>   Source S3 bucket name
  -t, --target-bucket <name>   Target S3 bucket name
  -r, --region <region>        AWS region
  -p, --profile <profile>      AWS profile (optional)
  -d, --dry-run                Dry run mode (no actual copy)
  -c, --concurrency <num>      Concurrent copies (default: 10)
  -h, --help                   Show help

Example:
  npx ts-node import/s3Copy.ts \\
    -m ./output/s3-mappings.json \\
    -s bedrock-chat-docs-prod-tenant1 \\
    -t docs-prod-tenant-tenant1-abc123 \\
    -r ap-northeast-1 \\
    -p my-profile \\
    -d
`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('=== S3 File Copy ===');
  console.log(`Mapping File: ${options.mappingFile}`);
  console.log(`Source Bucket: ${options.sourceBucket}`);
  console.log(`Target Bucket: ${options.targetBucket}`);
  console.log(`Region: ${options.region}`);
  console.log(`Profile: ${options.profile || '(default)'}`);
  console.log(`Dry Run: ${options.dryRun}`);
  console.log(`Concurrency: ${options.concurrency}`);

  // マッピングファイルを読み込み
  const mappings: S3CopyMapping[] = JSON.parse(
    fs.readFileSync(options.mappingFile, 'utf-8')
  );

  console.log(`\nFound ${mappings.length} files to copy`);

  if (mappings.length === 0) {
    console.log('No files to copy. Exiting.');
    return;
  }

  // S3 クライアント作成
  const client = createS3Client(options.region, options.profile);

  // コピー実行
  console.log('\nStarting copy...\n');
  const stats = await copyFiles(
    client,
    options.sourceBucket,
    options.targetBucket,
    mappings,
    options.dryRun,
    options.concurrency
  );

  // 結果を保存
  const outputDir = path.dirname(options.mappingFile);
  const statsPath = path.join(outputDir, 's3-copy-stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));

  // 統計を表示
  console.log('\n=== Copy Statistics ===');
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
    console.log('\nCopy completed with errors!');
    process.exit(1);
  } else {
    console.log('\nCopy completed successfully!');
  }
}

main().catch((error) => {
  console.error('Copy failed:', error);
  process.exit(1);
});
