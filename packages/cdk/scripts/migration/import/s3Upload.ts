/**
 * S3 File Upload
 * ローカルにバックアップしたファイルを新しい S3 バケットにアップロード
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { S3CopyMapping, CopyStatistics } from '../types';

// ============================================================================
// Types
// ============================================================================

interface UploadResult {
  success: boolean;
  localPath: string;
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
 * Content-Type を拡張子から推測
 */
function getContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx':
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  return contentTypes[ext] || 'application/octet-stream';
}

/**
 * 単一ファイルをアップロード
 */
export async function uploadObject(
  client: S3Client,
  targetBucket: string,
  localPath: string,
  targetKey: string,
  dryRun: boolean
): Promise<UploadResult> {
  try {
    // ローカルファイルの存在確認
    if (!fs.existsSync(localPath)) {
      return {
        success: false,
        localPath,
        targetKey,
        skipped: true,
        skipReason: 'Local file not found',
      };
    }

    // ターゲットの存在確認（既存の場合はスキップ）
    const targetExists = await objectExists(client, targetBucket, targetKey);
    if (targetExists) {
      return {
        success: true,
        localPath,
        targetKey,
        skipped: true,
        skipReason: 'Target file already exists',
      };
    }

    if (dryRun) {
      console.log(`[DRY-RUN] Would upload: ${localPath} -> ${targetKey}`);
      return {
        success: true,
        localPath,
        targetKey,
        skipped: true,
        skipReason: 'Dry run',
      };
    }

    // ファイルを読み込み
    const fileContent = fs.readFileSync(localPath);
    const contentType = getContentType(path.basename(localPath));

    // アップロード実行
    await client.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: targetKey,
        Body: fileContent,
        ContentType: contentType,
      })
    );

    return {
      success: true,
      localPath,
      targetKey,
    };
  } catch (error) {
    return {
      success: false,
      localPath,
      targetKey,
      error: String(error),
    };
  }
}

/**
 * ローカルファイルパスを S3 マッピングから解決
 *
 * バックアップディレクトリ構造:
 *   {backupDir}/files/{userId}/{botId}/documents/{filename}
 *
 * マッピングの sourceKey 構造:
 *   {userId}/{botId}/documents/{filename}
 */
export function resolveLocalPath(backupDir: string, sourceKey: string): string {
  return path.join(backupDir, 'files', sourceKey);
}

/**
 * バッチでファイルをアップロード
 */
export async function uploadFiles(
  client: S3Client,
  targetBucket: string,
  backupDir: string,
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

  console.log(`ローカルディレクトリ: ${backupDir}`);
  console.log(`ターゲットバケット: ${targetBucket}`);
  console.log(`対象ファイル数: ${mappings.length}`);

  // バッチ処理
  for (let i = 0; i < mappings.length; i += concurrency) {
    const batch = mappings.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((mapping) => {
        const localPath = resolveLocalPath(backupDir, mapping.sourceKey);
        return uploadObject(
          client,
          targetBucket,
          localPath,
          mapping.targetKey,
          dryRun
        );
      })
    );

    for (const result of results) {
      if (result.success) {
        if (result.skipped) {
          stats.skipped++;
          if (result.skipReason !== 'Dry run') {
            console.log(
              `  Skipped: ${result.localPath} (${result.skipReason})`
            );
          }
        } else {
          stats.success++;
          console.log(`  Uploaded: ${result.localPath} -> ${result.targetKey}`);
        }
      } else {
        stats.failed++;
        const errorMsg = `Failed: ${result.localPath} - ${result.error || result.skipReason}`;
        stats.errors.push(errorMsg);
        console.error(`  ${errorMsg}`);
      }
    }

    // 進捗表示
    const processed = Math.min(i + concurrency, mappings.length);
    if (processed % 10 === 0 || processed === mappings.length) {
      console.log(`Progress: ${processed}/${mappings.length}`);
    }
  }

  return stats;
}
