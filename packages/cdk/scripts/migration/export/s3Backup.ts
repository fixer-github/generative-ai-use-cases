/**
 * S3 Backup
 * Bot のナレッジファイルを S3 からローカルにバックアップ
 */

import * as fs from 'fs';
import * as path from 'path';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { V053Bot, AWSClientConfig, S3BackupResult } from '../types';
import { createS3Client } from '../utils/aws';

// ============================================================================
// Types
// ============================================================================

interface FileToDownload {
  s3Key: string;
  localPath: string;
  userId: string;
  botId: string;
  fileName: string;
}

// ============================================================================
// S3 Backup Functions
// ============================================================================

/**
 * Bot データから S3 ファイルリストを抽出
 */
export function extractS3Files(bots: V053Bot[]): FileToDownload[] {
  const files: FileToDownload[] = [];

  for (const bot of bots) {
    // SK が BOT# で始まらない場合はスキップ（ALIAS など）
    if (!bot.SK.startsWith('BOT#')) {
      continue;
    }

    const userId = bot.PK;
    const botId = bot.BotId || bot.SK.replace('BOT#', '');

    // Knowledge.filenames からファイルを抽出
    if (bot.Knowledge?.filenames) {
      for (const filename of bot.Knowledge.filenames) {
        const s3Key = `${userId}/${botId}/documents/${filename}`;
        const localPath = path.join(userId, botId, 'documents', filename);

        files.push({
          s3Key,
          localPath,
          userId,
          botId,
          fileName: filename,
        });
      }
    }
  }

  return files;
}

/**
 * S3 オブジェクトが存在するか確認
 */
async function objectExists(
  s3Client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await s3Client.send(
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
 * S3 からファイルをダウンロード
 */
async function downloadFile(
  s3Client: S3Client,
  bucket: string,
  key: string,
  localPath: string
): Promise<void> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error(`Empty response body for ${key}`);
  }

  // ディレクトリを作成
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ファイルに書き込み
  const stream = response.Body as Readable;
  const writeStream = fs.createWriteStream(localPath);

  return new Promise((resolve, reject) => {
    stream.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}

/**
 * S3 ファイルをバックアップ
 */
export async function backupS3Files(
  bots: V053Bot[],
  bucketName: string,
  outputDir: string,
  config: AWSClientConfig,
  concurrency: number = 10
): Promise<S3BackupResult> {
  const s3Client = createS3Client(config);
  const files = extractS3Files(bots);

  console.log(`S3 バケット "${bucketName}" からファイルをバックアップ中...`);
  console.log(`対象ファイル数: ${files.length}`);

  if (files.length === 0) {
    console.log('バックアップ対象のファイルがありません');
    return {
      bucketName,
      outputDir,
      totalFiles: 0,
      downloadedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      errors: [],
      exportedAt: new Date().toISOString(),
    };
  }

  let downloadedFiles = 0;
  let skippedFiles = 0;
  let failedFiles = 0;
  const errors: string[] = [];

  // 並列処理でダウンロード
  const chunks: FileToDownload[][] = [];
  for (let i = 0; i < files.length; i += concurrency) {
    chunks.push(files.slice(i, i + concurrency));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    await Promise.all(
      chunk.map(async (file) => {
        const localPath = path.join(outputDir, 'files', file.localPath);

        try {
          // ローカルに既存のファイルがあればスキップ
          if (fs.existsSync(localPath)) {
            skippedFiles++;
            return;
          }

          // S3 に存在するか確認
          const exists = await objectExists(s3Client, bucketName, file.s3Key);
          if (!exists) {
            skippedFiles++;
            console.warn(`  スキップ: ${file.s3Key} (S3に存在しません)`);
            return;
          }

          // ダウンロード
          await downloadFile(s3Client, bucketName, file.s3Key, localPath);
          downloadedFiles++;
        } catch (error) {
          failedFiles++;
          const errorMsg = `${file.s3Key}: ${error}`;
          errors.push(errorMsg);
          console.error(`  失敗: ${errorMsg}`);
        }
      })
    );

    // 進捗を表示
    const processed = Math.min((i + 1) * concurrency, files.length);
    if (processed % 50 === 0 || processed === files.length) {
      console.log(
        `  進捗: ${processed}/${files.length} (ダウンロード: ${downloadedFiles}, スキップ: ${skippedFiles}, 失敗: ${failedFiles})`
      );
    }
  }

  console.log(`ダウンロード完了: ${downloadedFiles} 件`);

  return {
    bucketName,
    outputDir,
    totalFiles: files.length,
    downloadedFiles,
    skippedFiles,
    failedFiles,
    errors,
    exportedAt: new Date().toISOString(),
  };
}
