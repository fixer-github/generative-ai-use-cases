#!/usr/bin/env node

/**
 * GenU Migration CLI
 * v0.5.3 → develop 移行自動化スクリプト
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

// Config
import {
  MigrationConfig,
  MigrationResults,
  MigrationError,
  BackupManifest,
  DiscoveredEnvironment,
  DiscoveredTenant,
  VerificationResult,
} from './config/types';
import {
  loadConfig,
  generateSampleConfig,
  prepareOutputDirectory,
  createTimestampedDirectory,
} from './config/loader';

// Utils
import * as logger from './utils/logger';
import { enableVerbose } from './utils/logger';
import { AWSClientConfig } from './utils/aws';

// Discovery
import {
  discoverEnvironments,
  discoverEnvironmentByName,
  formatEnvironmentSummary,
} from './discovery/environment';
import {
  discoverTenants,
  createDefaultTenant,
  formatTenantSummary,
  isActiveTenant,
} from './discovery/tenant';

// Backup
import {
  exportDefaultTenantSystemContexts,
  exportTenantSystemContexts,
} from './backup/systemContext';
import {
  backupDefaultTenantTables,
  backupTenantTables,
} from './backup/dynamodb';
import {
  exportDefaultTenantData,
  exportTenantData,
  saveSystemContextBackup,
  createBackupManifest,
  saveBackupManifest,
  saveDynamoDBBackupsList,
} from './backup/export';

// Verification
import {
  verifyDefaultTenant,
  verifyTenant,
  formatVerificationSummary,
} from './verification/counts';

// Report
import {
  generateReport,
  saveReport,
  calculateSummary,
} from './report/generator';

const program = new Command();

program
  .name('migration')
  .description('GenU v0.5.3 → develop 移行自動化スクリプト')
  .version('1.0.0');

/**
 * discover コマンド
 * 環境とテナントを自動検出
 */
program
  .command('discover')
  .description('環境とテナントを自動検出')
  .requiredOption('-r, --region <region>', 'AWS リージョン')
  .option('-p, --profile <profile>', 'AWS プロファイル')
  .option('-o, --output <path>', '出力ファイルパス')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      enableVerbose();
    }

    logger.section('環境・テナント検出');

    const config: AWSClientConfig = {
      region: options.region,
      profile: options.profile,
    };

    try {
      // 環境を検出
      const environments = await discoverEnvironments(config);
      logger.newLine();
      logger.info(formatEnvironmentSummary(environments));

      // テナントを検出
      const allTenants: DiscoveredTenant[] = [];

      for (const env of environments) {
        if (env.tenantsTableName) {
          const tenants = await discoverTenants(
            env.tenantsTableName,
            env,
            config
          );
          allTenants.push(...tenants);
        } else {
          // デフォルトテナントを作成
          const defaultTenant = createDefaultTenant(env);
          allTenants.push(defaultTenant);
        }
      }

      logger.newLine();
      logger.info(formatTenantSummary(allTenants));

      // 結果を保存
      if (options.output) {
        const outputData = {
          discoveredAt: new Date().toISOString(),
          region: options.region,
          environments,
          tenants: allTenants,
        };

        fs.writeFileSync(options.output, JSON.stringify(outputData, null, 2));
        logger.success(`検出結果を ${options.output} に保存しました`);
      }

      logger.section('検出完了');
    } catch (error) {
      logger.error('検出に失敗しました:', error);
      process.exit(1);
    }
  });

/**
 * backup コマンド
 * データバックアップを作成
 */
program
  .command('backup')
  .description('データバックアップを作成')
  .requiredOption('-c, --config <path>', '設定ファイルパス')
  .option('-d, --dry-run', 'ドライランモード')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      enableVerbose();
    }

    logger.section('バックアップ');

    if (options.dryRun) {
      logger.dryRunWarning();
    }

    try {
      const config = loadConfig(options.config);
      logger.info(`設定ファイルを読み込みました: ${options.config}`);

      await runBackup(config, options.dryRun || config.settings.dryRun);

      logger.section('バックアップ完了');
    } catch (error) {
      logger.error('バックアップに失敗しました:', error);
      process.exit(1);
    }
  });

/**
 * verify コマンド
 * データ整合性を検証
 */
program
  .command('verify')
  .description('データ整合性を検証')
  .requiredOption('-c, --config <path>', '設定ファイルパス')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      enableVerbose();
    }

    logger.section('検証');

    try {
      const config = loadConfig(options.config);
      logger.info(`設定ファイルを読み込みました: ${options.config}`);

      await runVerification(config);

      logger.section('検証完了');
    } catch (error) {
      logger.error('検証に失敗しました:', error);
      process.exit(1);
    }
  });

/**
 * report コマンド
 * 移行準備レポートを生成
 */
program
  .command('report')
  .description('移行準備レポートを生成')
  .requiredOption('-c, --config <path>', '設定ファイルパス')
  .option('-o, --output <path>', '出力ディレクトリ')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      enableVerbose();
    }

    logger.section('レポート生成');

    try {
      const config = loadConfig(options.config);
      const outputDir = options.output || config.settings.outputDir;

      logger.info(`設定ファイルを読み込みました: ${options.config}`);

      // 検出・検証を実行してレポートを生成
      const results = await runFullMigration(config, true);
      const report = await generateReport(results);

      const reportDir = path.join(outputDir, 'reports');
      const { markdownPath, jsonPath } = saveReport(report, reportDir);

      logger.success(`Markdown レポート: ${markdownPath}`);
      logger.success(`JSON レポート: ${jsonPath}`);

      logger.section('レポート生成完了');
    } catch (error) {
      logger.error('レポート生成に失敗しました:', error);
      process.exit(1);
    }
  });

/**
 * full コマンド
 * 全自動実行（検出・バックアップ・検証・レポート）
 */
program
  .command('full')
  .description('全自動実行（検出・バックアップ・検証・レポート）')
  .requiredOption('-c, --config <path>', '設定ファイルパス')
  .requiredOption('-o, --output <path>', '出力ディレクトリ')
  .option('-d, --dry-run', 'ドライランモード')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      enableVerbose();
    }

    logger.section('GenU 移行スクリプト - 全自動実行');

    if (options.dryRun) {
      logger.dryRunWarning();
    }

    try {
      const config = loadConfig(options.config);

      // 出力ディレクトリを上書き
      config.settings.outputDir = options.output;
      if (options.dryRun !== undefined) {
        config.settings.dryRun = options.dryRun;
      }

      logger.info(`設定ファイルを読み込みました: ${options.config}`);
      logger.info(`出力ディレクトリ: ${config.settings.outputDir}`);

      // 出力ディレクトリを準備
      prepareOutputDirectory(config.settings.outputDir);

      // 全実行
      const results = await runFullMigration(config, config.settings.dryRun);

      // レポートを生成
      const report = await generateReport(results);

      const reportDir = path.join(config.settings.outputDir, 'reports');
      const { markdownPath, jsonPath } = saveReport(report, reportDir);

      logger.section('完了');
      logger.success(`Markdown レポート: ${markdownPath}`);
      logger.success(`JSON レポート: ${jsonPath}`);

      // サマリーを表示
      logger.newLine();
      logger.info('=== サマリー ===');
      logger.info(`環境数: ${results.summary.environmentCount}`);
      logger.info(`テナント数: ${results.summary.tenantCount}`);
      logger.info(`バックアップ数: ${results.summary.backupCount}`);
      logger.info(`成功: ${results.summary.successCount}`);
      logger.info(`失敗: ${results.summary.failureCount}`);

      if (results.errors.length > 0) {
        logger.warn(`エラー: ${results.errors.length} 件`);
        process.exit(1);
      }
    } catch (error) {
      logger.error('実行に失敗しました:', error);
      process.exit(1);
    }
  });

/**
 * init コマンド
 * サンプル設定ファイルを生成
 */
program
  .command('init')
  .description('サンプル設定ファイルを生成')
  .option('-o, --output <path>', '出力ファイルパス', 'migration-config.json')
  .action((options) => {
    const sampleConfig = generateSampleConfig();
    fs.writeFileSync(options.output, sampleConfig, 'utf-8');
    logger.success(`サンプル設定ファイルを ${options.output} に生成しました`);
  });

/**
 * バックアップを実行する
 */
async function runBackup(
  config: MigrationConfig,
  dryRun: boolean
): Promise<BackupManifest[]> {
  const manifests: BackupManifest[] = [];
  const outputDir = config.settings.outputDir;

  prepareOutputDirectory(outputDir);
  const backupsDir = createTimestampedDirectory(path.join(outputDir, 'backups'));

  for (const envConfig of config.environments) {
    logger.subsection(`環境: ${envConfig.name}`);

    const awsConfig: AWSClientConfig = {
      region: envConfig.region,
      profile: envConfig.awsProfile,
    };

    // 環境を検出
    const env = await discoverEnvironmentByName(envConfig.name, awsConfig);
    if (!env) {
      logger.warn(`環境 "${envConfig.name}" が見つかりませんでした`);
      continue;
    }

    const envDir = path.join(backupsDir, envConfig.name);

    // デフォルトテナントのバックアップ
    if (env.chatHistoryTableName) {
      logger.info('デフォルトテナントをバックアップ中...');

      const tableNames = [
        env.chatHistoryTableName,
        env.tokenUsageStatsTableName,
        env.useCaseBuilderTableName,
      ].filter((n): n is string => !!n);

      // DynamoDB バックアップ
      const dynamoBackups = await backupDefaultTenantTables(
        tableNames,
        awsConfig,
        dryRun
      );

      // SystemContext エクスポート
      let systemContextPath: string | undefined;
      if (config.settings.tables.includeData.systemContexts && env.chatHistoryTableName) {
        const systemContextBackup = await exportDefaultTenantSystemContexts(
          env.chatHistoryTableName,
          awsConfig
        );
        systemContextPath = saveSystemContextBackup(
          systemContextBackup,
          path.join(envDir, 'default', 'systemContexts.json')
        );
      }

      // JSON エクスポート
      const { exports } = await exportDefaultTenantData(
        {
          chatHistory: env.chatHistoryTableName,
          tokenUsageStats: env.tokenUsageStatsTableName,
          useCaseBuilder: env.useCaseBuilderTableName,
        },
        awsConfig,
        envDir,
        config.settings.tables.includeData
      );

      const manifest = createBackupManifest(
        envConfig.name,
        'default',
        dynamoBackups,
        { systemContexts: systemContextPath, ...exports }
      );

      saveBackupManifest(manifest, path.join(envDir, 'default'));
      manifests.push(manifest);
    }

    // テナントのバックアップ
    if (env.tenantsTableName) {
      const tenants = await discoverTenants(
        env.tenantsTableName,
        env,
        awsConfig,
        envConfig.excludeTenants
      );

      for (const tenant of tenants) {
        if (!isActiveTenant(tenant)) {
          logger.warn(`テナント "${tenant.tenantId}" は非アクティブのためスキップします`);
          continue;
        }

        logger.info(`テナント "${tenant.tenantId}" をバックアップ中...`);

        try {
          // DynamoDB バックアップ
          const dynamoBackups = await backupTenantTables(tenant, awsConfig, dryRun);

          // SystemContext エクスポート
          let systemContextPath: string | undefined;
          if (config.settings.tables.includeData.systemContexts) {
            const systemContextBackup = await exportTenantSystemContexts(tenant, awsConfig);
            systemContextPath = saveSystemContextBackup(
              systemContextBackup,
              path.join(envDir, `tenant-${tenant.tenantId}`, 'systemContexts.json')
            );
          }

          // JSON エクスポート
          const { exports } = await exportTenantData(
            tenant,
            awsConfig,
            envDir,
            config.settings.tables.includeData
          );

          const manifest = createBackupManifest(
            envConfig.name,
            tenant.tenantId,
            dynamoBackups,
            { systemContexts: systemContextPath, ...exports }
          );

          saveBackupManifest(manifest, path.join(envDir, `tenant-${tenant.tenantId}`));
          manifests.push(manifest);
        } catch (error) {
          logger.error(`テナント "${tenant.tenantId}" のバックアップに失敗しました:`, error);
        }
      }
    }
  }

  // バックアップ一覧を保存
  const allBackups = manifests.flatMap((m) => m.backups.dynamodb);
  saveDynamoDBBackupsList(allBackups, path.join(backupsDir, 'dynamodb-backups.json'));

  return manifests;
}

/**
 * 検証を実行する
 */
async function runVerification(config: MigrationConfig): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const envConfig of config.environments) {
    logger.subsection(`環境: ${envConfig.name}`);

    const awsConfig: AWSClientConfig = {
      region: envConfig.region,
      profile: envConfig.awsProfile,
    };

    // 環境を検出
    const env = await discoverEnvironmentByName(envConfig.name, awsConfig);
    if (!env) {
      logger.warn(`環境 "${envConfig.name}" が見つかりませんでした`);
      continue;
    }

    // デフォルトテナントの検証
    if (env.chatHistoryTableName) {
      const tableNames = [
        env.chatHistoryTableName,
        env.tokenUsageStatsTableName,
        env.useCaseBuilderTableName,
      ].filter((n): n is string => !!n);

      const result = await verifyDefaultTenant(tableNames, envConfig.name, awsConfig);
      results.push(result);

      logger.newLine();
      logger.info(formatVerificationSummary(result));
    }

    // テナントの検証
    if (env.tenantsTableName) {
      const tenants = await discoverTenants(
        env.tenantsTableName,
        env,
        awsConfig,
        envConfig.excludeTenants
      );

      for (const tenant of tenants) {
        if (!isActiveTenant(tenant)) {
          continue;
        }

        try {
          const result = await verifyTenant(tenant, awsConfig);
          results.push(result);

          logger.newLine();
          logger.info(formatVerificationSummary(result));
        } catch (error) {
          logger.error(`テナント "${tenant.tenantId}" の検証に失敗しました:`, error);
        }
      }
    }
  }

  return results;
}

/**
 * 全移行処理を実行する
 */
async function runFullMigration(
  config: MigrationConfig,
  dryRun: boolean
): Promise<MigrationResults> {
  const results: MigrationResults = {
    config,
    executedAt: new Date().toISOString(),
    environments: [],
    tenants: [],
    backupManifests: [],
    verificationResults: [],
    summary: {
      environmentCount: 0,
      tenantCount: 0,
      backupCount: 0,
      successCount: 0,
      failureCount: 0,
      warningCount: 0,
    },
    errors: [],
  };

  // 1. 検出
  logger.section('Phase 1: 環境・テナント検出');

  for (const envConfig of config.environments) {
    const awsConfig: AWSClientConfig = {
      region: envConfig.region,
      profile: envConfig.awsProfile,
    };

    try {
      const env = await discoverEnvironmentByName(envConfig.name, awsConfig);
      if (env) {
        results.environments.push(env);

        if (env.tenantsTableName) {
          const tenants = await discoverTenants(
            env.tenantsTableName,
            env,
            awsConfig,
            envConfig.excludeTenants
          );
          results.tenants.push(...tenants);
        } else {
          const defaultTenant = createDefaultTenant(env);
          results.tenants.push(defaultTenant);
        }
      }
    } catch (error) {
      const migrationError: MigrationError = {
        phase: 'discovery',
        environment: envConfig.name,
        message: String(error),
        error,
        occurredAt: new Date().toISOString(),
      };
      results.errors.push(migrationError);
    }
  }

  // 2. バックアップ
  logger.section('Phase 2: バックアップ');

  try {
    results.backupManifests = await runBackup(config, dryRun);
  } catch (error) {
    const migrationError: MigrationError = {
      phase: 'backup',
      message: String(error),
      error,
      occurredAt: new Date().toISOString(),
    };
    results.errors.push(migrationError);
  }

  // 3. 検証
  logger.section('Phase 3: 検証');

  try {
    results.verificationResults = await runVerification(config);
  } catch (error) {
    const migrationError: MigrationError = {
      phase: 'verification',
      message: String(error),
      error,
      occurredAt: new Date().toISOString(),
    };
    results.errors.push(migrationError);
  }

  // 4. サマリー計算
  results.completedAt = new Date().toISOString();
  results.summary = calculateSummary(results);

  return results;
}

// CLI を実行
program.parse(process.argv);
