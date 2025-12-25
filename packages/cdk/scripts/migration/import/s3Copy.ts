/**
 * S3 File Copy
 * v0.5.3 の S3 パス構造から develop のパス構造にファイルをコピー
 */

import {
  S3Client,
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { S3CopyMapping, CopyStatistics } from '../types';

// ============================================================================
// Types
// ============================================================================

interface CopyResult {
  success: boolean;
  sourceKey: string;
  targetKey: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

// ============================================================================
// S3 Operations
// ============================================================================

/**
 * S3 クライアントを作成
 */
export function createS3Client(region: string, profile?: string): S3Client {
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
export async function objectExists(
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
export async function copyObject(
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
export async function copyFiles(
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
export async function listAllObjects(
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
