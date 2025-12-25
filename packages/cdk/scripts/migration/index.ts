#!/usr/bin/env node

/**
 * GenU Migration CLI
 * v0.5.3 → develop 移行スクリプト
 *
 * コマンド:
 * - export: Bot テーブルを JSON エクスポート
 * - transform: Bot → Assistant 変換
 * - import: Assistant を DynamoDB 投入 + S3 コピー
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

// Types
import { V053Bot, AssistantItem, S3CopyMapping, AWSClientConfig } from './types';

// Export
import { exportBotTable, scanBotTable, saveBotData } from './export/botExport';
import { backupS3Files } from './export/s3Backup';

// Transform
import { transformBots } from './transform/botToAssistant';

// Import
import {
  createDynamoDBClient,
  importAssistants,
  tableExists,
} from './import/assistantImport';
import { createS3Client, copyFiles } from './import/s3Copy';
import {
  createS3Client as createS3ClientForUpload,
  uploadFiles,
} from './import/s3Upload';

const program = new Command();

program
  .name('migration')
  .description('GenU v0.5.3 → develop 移行スクリプト')
  .version('2.0.0');

// ============================================================================
// export コマンド
// ============================================================================

program
  .command('export')
  .description('Bot テーブルと S3 ファイルをエクスポート')
  .requiredOption('-t, --table <name>', 'DynamoDB テーブル名')
  .requiredOption('-r, --region <region>', 'AWS リージョン')
  .requiredOption('-o, --output <path>', '出力ディレクトリ')
  .option('-b, --bucket <name>', 'S3 バケット名（ファイルバックアップ用）')
  .option('-p, --profile <profile>', 'AWS プロファイル')
  .option('-c, --concurrency <num>', 'S3 ダウンロード同時実行数', '10')
  .action(async (options) => {
    console.log('=== Bot データエクスポート ===');
    console.log(`テーブル: ${options.table}`);
    console.log(`リージョン: ${options.region}`);
    console.log(`出力ディレクトリ: ${options.output}`);
    if (options.bucket) {
      console.log(`S3 バケット: ${options.bucket}`);
    }

    try {
      const config: AWSClientConfig = {
        region: options.region,
        profile: options.profile,
      };

      // 出力ディレクトリを作成
      if (!fs.existsSync(options.output)) {
        fs.mkdirSync(options.output, { recursive: true });
      }

      // Bot テーブルをスキャン
      const { createDynamoDBDocClient } = await import('./utils/aws');
      const docClient = createDynamoDBDocClient(config);
      const bots = await scanBotTable(options.table, docClient);

      // JSON ファイルに保存
      const botsJsonPath = path.join(options.output, 'bots.json');
      const botResult = saveBotData(bots, options.table, botsJsonPath);

      console.log('\n=== DynamoDB エクスポート結果 ===');
      console.log(`アイテム数: ${botResult.itemCount}`);
      console.log(`出力ファイル: ${botResult.outputPath}`);

      // S3 バックアップ（オプション）
      if (options.bucket) {
        console.log('\n--- S3 ファイルバックアップ ---');
        const concurrency = parseInt(options.concurrency, 10);
        const s3Result = await backupS3Files(
          bots,
          options.bucket,
          options.output,
          config,
          concurrency
        );

        console.log('\n=== S3 バックアップ結果 ===');
        console.log(`総ファイル数: ${s3Result.totalFiles}`);
        console.log(`ダウンロード: ${s3Result.downloadedFiles}`);
        console.log(`スキップ: ${s3Result.skippedFiles}`);
        console.log(`失敗: ${s3Result.failedFiles}`);

        if (s3Result.errors.length > 0) {
          console.log(`エラー: ${s3Result.errors.length} 件`);
          s3Result.errors.slice(0, 5).forEach((e) => console.log(`  - ${e}`));
        }

        // S3 バックアップ結果を保存
        const s3StatsPath = path.join(options.output, 's3-backup-stats.json');
        fs.writeFileSync(s3StatsPath, JSON.stringify(s3Result, null, 2));
        console.log(`統計ファイル: ${s3StatsPath}`);
      }

      console.log('\nエクスポート完了');
    } catch (error) {
      console.error('エクスポートに失敗しました:', error);
      process.exit(1);
    }
  });

// ============================================================================
// transform コマンド
// ============================================================================

program
  .command('transform')
  .description('Bot データを Assistant 形式に変換')
  .requiredOption('-i, --input <path>', '入力ファイルパス（エクスポート JSON）')
  .requiredOption('-o, --output <path>', '出力ディレクトリ')
  .requiredOption('-t, --tenant-id <id>', 'テナント ID')
  .option(
    '-m, --model-id <id>',
    'デフォルトモデル ID',
    'anthropic.claude-3-5-sonnet-20241022-v2:0'
  )
  .action(async (options) => {
    console.log('=== Bot → Assistant 変換 ===');
    console.log(`入力: ${options.input}`);
    console.log(`出力: ${options.output}`);
    console.log(`テナント ID: ${options.tenantId}`);

    try {
      // 入力ファイルを読み込み
      const inputData = JSON.parse(fs.readFileSync(options.input, 'utf-8'));
      const bots: V053Bot[] = inputData.Items || inputData;

      console.log(`Bot 数: ${bots.length}`);

      // 変換実行
      const result = transformBots(bots, options.tenantId, options.modelId);

      // 出力ディレクトリを作成
      if (!fs.existsSync(options.output)) {
        fs.mkdirSync(options.output, { recursive: true });
      }

      // 結果を保存
      const assistantsPath = path.join(options.output, 'assistants.json');
      const s3MappingsPath = path.join(options.output, 's3-mappings.json');
      const idMappingPath = path.join(options.output, 'id-mapping.json');
      const statsPath = path.join(options.output, 'transform-stats.json');

      fs.writeFileSync(
        assistantsPath,
        JSON.stringify(result.assistants, null, 2)
      );
      fs.writeFileSync(
        s3MappingsPath,
        JSON.stringify(result.s3Mappings, null, 2)
      );
      fs.writeFileSync(
        idMappingPath,
        JSON.stringify(result.botIdToAssistantId, null, 2)
      );
      fs.writeFileSync(
        statsPath,
        JSON.stringify(result.statistics, null, 2)
      );

      // 統計を表示
      console.log('\n=== 変換統計 ===');
      console.log(`Bot 総数: ${result.statistics.totalBots}`);
      console.log(`変換済み Assistant: ${result.statistics.transformedAssistants}`);
      console.log(`ファイル数: ${result.statistics.totalFiles}`);
      console.log(`URL 数: ${result.statistics.totalUrls}`);
      console.log(`スキップ: ${result.statistics.skipped}`);

      if (result.statistics.errors.length > 0) {
        console.log(`エラー: ${result.statistics.errors.length} 件`);
        result.statistics.errors.forEach((e) => console.log(`  - ${e}`));
      }

      console.log('\n=== 出力ファイル ===');
      console.log(`Assistants: ${assistantsPath}`);
      console.log(`S3 Mappings: ${s3MappingsPath}`);
      console.log(`ID Mapping: ${idMappingPath}`);
      console.log(`Statistics: ${statsPath}`);
      console.log('\n変換完了');
    } catch (error) {
      console.error('変換に失敗しました:', error);
      process.exit(1);
    }
  });

// ============================================================================
// import コマンド
// ============================================================================

program
  .command('import')
  .description('変換済みデータを新環境に投入')
  .requiredOption('-a, --assistants <path>', 'Assistants JSON ファイルパス')
  .option('-s, --s3-mappings <path>', 'S3 マッピング JSON ファイルパス')
  .requiredOption('-t, --table <name>', 'DynamoDB テーブル名')
  .option('--source-bucket <name>', 'ソース S3 バケット名（S3→S3 コピー時）')
  .option('--target-bucket <name>', 'ターゲット S3 バケット名')
  .option(
    '--local-files <path>',
    'ローカルバックアップディレクトリ（ローカル→S3 アップロード時）'
  )
  .requiredOption('-r, --region <region>', 'AWS リージョン')
  .option('-p, --profile <profile>', 'AWS プロファイル')
  .option('-d, --dry-run', 'ドライランモード')
  .option('-c, --concurrency <num>', 'S3 コピー/アップロード同時実行数', '10')
  .action(async (options) => {
    console.log('=== データインポート ===');

    if (options.dryRun) {
      console.log('[DRY-RUN モード]');
    }

    try {
      // DynamoDB インポート
      console.log('\n--- DynamoDB インポート ---');
      console.log(`テーブル: ${options.table}`);
      console.log(`リージョン: ${options.region}`);

      const assistants: AssistantItem[] = JSON.parse(
        fs.readFileSync(options.assistants, 'utf-8')
      );
      console.log(`Assistant 数: ${assistants.length}`);

      const dynamoClient = createDynamoDBClient(options.region, options.profile);

      // テーブル存在確認
      const exists = await tableExists(dynamoClient, options.table);
      if (!exists) {
        console.error(`テーブル "${options.table}" が存在しません`);
        process.exit(1);
      }

      // インポート実行
      const importStats = await importAssistants(
        dynamoClient,
        options.table,
        assistants,
        options.dryRun || false,
        true // skipExisting
      );

      console.log('\n=== DynamoDB インポート統計 ===');
      console.log(`総数: ${importStats.total}`);
      console.log(`成功: ${importStats.success}`);
      console.log(`スキップ: ${importStats.skipped}`);
      console.log(`失敗: ${importStats.failed}`);

      // S3 ファイル処理（オプション）
      if (options.s3Mappings && options.targetBucket) {
        const mappings: S3CopyMapping[] = JSON.parse(
          fs.readFileSync(options.s3Mappings, 'utf-8')
        );
        const concurrency = parseInt(options.concurrency, 10);

        // ローカルファイルからアップロード
        if (options.localFiles) {
          console.log('\n--- S3 ファイルアップロード（ローカル→S3）---');
          console.log(`ローカルディレクトリ: ${options.localFiles}`);
          console.log(`ターゲットバケット: ${options.targetBucket}`);
          console.log(`ファイル数: ${mappings.length}`);

          const s3Client = createS3ClientForUpload(
            options.region,
            options.profile
          );

          const uploadStats = await uploadFiles(
            s3Client,
            options.targetBucket,
            options.localFiles,
            mappings,
            options.dryRun || false,
            concurrency
          );

          console.log('\n=== S3 アップロード統計 ===');
          console.log(`総数: ${uploadStats.total}`);
          console.log(`成功: ${uploadStats.success}`);
          console.log(`スキップ: ${uploadStats.skipped}`);
          console.log(`失敗: ${uploadStats.failed}`);

          if (uploadStats.errors.length > 0) {
            console.log(`エラー: ${uploadStats.errors.length} 件`);
            uploadStats.errors
              .slice(0, 5)
              .forEach((e) => console.log(`  - ${e}`));
          }
        }
        // S3 から S3 へコピー
        else if (options.sourceBucket) {
          console.log('\n--- S3 ファイルコピー（S3→S3）---');
          console.log(`ソースバケット: ${options.sourceBucket}`);
          console.log(`ターゲットバケット: ${options.targetBucket}`);
          console.log(`ファイル数: ${mappings.length}`);

          const s3Client = createS3Client(options.region, options.profile);

          const copyStats = await copyFiles(
            s3Client,
            options.sourceBucket,
            options.targetBucket,
            mappings,
            options.dryRun || false,
            concurrency
          );

          console.log('\n=== S3 コピー統計 ===');
          console.log(`総数: ${copyStats.total}`);
          console.log(`成功: ${copyStats.success}`);
          console.log(`スキップ: ${copyStats.skipped}`);
          console.log(`失敗: ${copyStats.failed}`);

          if (copyStats.errors.length > 0) {
            console.log(`エラー: ${copyStats.errors.length} 件`);
            copyStats.errors
              .slice(0, 5)
              .forEach((e) => console.log(`  - ${e}`));
          }
        } else {
          console.warn(
            '\n警告: S3 マッピングが指定されていますが、--source-bucket または --local-files が必要です'
          );
        }
      }

      console.log('\nインポート完了');

      if (importStats.failed > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error('インポートに失敗しました:', error);
      process.exit(1);
    }
  });

// CLI を実行
program.parse(process.argv);
