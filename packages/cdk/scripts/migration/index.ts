#!/usr/bin/env node
/**
 * GenU 移行自動化スクリプト CLI
 * v0.5.3 → develop 移行準備ツール
 */

import { Command } from 'commander';
import * as path from 'path';
import { logger, LogLevel } from './utils/logger';
import {
  loadConfig,
  generateSampleConfig,
  printConfigSummary,
  applyEnvironmentOverrides,
} from './config/loader';
import {
  discoverEnvironments,
  saveEnvironmentsToFile,
} from './discovery/environment';
import {
  discoverTenants,
  filterActiveTenants,
  excludeTenants,
  saveTenantsToFile,
  printTenantSummary,
} from './discovery/tenant';
import {
  exportDefaultTenantSystemContexts,
  exportTenantSystemContexts,
  saveSystemContextBackup,
  printSystemContextSummary,
} from './backup/systemContext';
import {
  backupDefaultTenantTables,
  backupTenantTables,
  saveBackupResults,
  printBackupSummary,
} from './backup/dynamodb';
import {
  exportDefaultTenantTables,
  exportTenantTables,
  printExportSummary,
} from './backup/export';
import {
  countDefaultTenantTables,
  countTenantTables,
  saveCountResults,
  printCountSummary,
} from './verification/counts';
import {
  generateReport,
  saveReport,
  initializeResults,
  finalizeResults,
  addError,
  printFinalSummary,
} from './report/generator';
import {
  MigrationConfig,
  MigrationResults,
  DiscoveredEnvironment,
  DiscoveredTenant,
  BackupManifest,
  AWSClientConfig,
} from './config/types';
import { getCallerIdentity, isDefaultTenant } from './utils/aws';

const program = new Command();

program
  .name('migration')
  .description('GenU 移行自動化スクリプト (v0.5.3 → develop)')
  .version('1.0.0');

/**
 * discover コマンド: 環境とテナントを自動検出
 */
program
  .command('discover')
  .description('環境とテナントを自動検出')
  .requiredOption('-r, --region <region>', 'AWS リージョン')
  .option('-p, --profile <profile>', 'AWS プロファイル')
  .option('-o, --output <dir>', '出力ディレクトリ', './migration-output/discovery')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      logger.setLogLevel(LogLevel.DEBUG);
    }

    logger.phase('環境・テナント検出');

    const awsConfig: AWSClientConfig = {
      region: options.region,
      profile: options.profile,
    };

    try {
      // 現在のアイデンティティを確認
      const identity = await getCallerIdentity(awsConfig);
      logger.info(`AWS アカウント: ${identity.account}`);
      logger.info(`呼び出し元: ${identity.arn}`);

      // 環境検出
      logger.section('環境検出');
      const environments = await discoverEnvironments(awsConfig);

      if (environments.length === 0) {
        logger.warn('GenU 環境が見つかりませんでした');
        return;
      }

      // 出力ディレクトリを作成
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
      const outputDir = path.join(options.output, timestamp);

      await saveEnvironmentsToFile(
        environments,
        path.join(outputDir, 'environments.json')
      );

      // テナント検出
      logger.section('テナント検出');
      const allTenants: DiscoveredTenant[] = [];

      for (const env of environments) {
        if (env.tenantsTableName) {
          const tenants = await discoverTenants(
            awsConfig,
            env.tenantsTableName,
            env.name
          );
          allTenants.push(...tenants);
        } else {
          logger.warn(
            `環境 ${env.name} にはテナントテーブルが設定されていません`
          );
        }
      }

      await saveTenantsToFile(
        allTenants,
        path.join(outputDir, 'tenants.json')
      );

      printTenantSummary(allTenants);

      logger.success(`検出結果を保存しました: ${outputDir}`);
    } catch (error) {
      logger.error(
        `検出中にエラー: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  });

/**
 * backup コマンド: データバックアップを作成
 */
program
  .command('backup')
  .description('データバックアップを作成')
  .requiredOption('-c, --config <path>', '設定ファイルパス')
  .option('--dry-run', 'ドライラン（実際の変更なし）')
  .option('-o, --output <dir>', '出力ディレクトリを上書き')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      logger.setLogLevel(LogLevel.DEBUG);
    }

    logger.phase('バックアップ作成');

    try {
      let config = await loadConfig(options.config);
      config = applyEnvironmentOverrides(config);

      if (options.dryRun) {
        config.settings.dryRun = true;
      }

      if (options.output) {
        config.settings.outputDir = options.output;
      }

      printConfigSummary(config);

      await runBackup(config);
    } catch (error) {
      logger.error(
        `バックアップ中にエラー: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  });

/**
 * verify コマンド: データ整合性を検証
 */
program
  .command('verify')
  .description('データ整合性を検証')
  .requiredOption('-c, --config <path>', '設定ファイルパス')
  .option('-o, --output <dir>', '出力ディレクトリを上書き')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      logger.setLogLevel(LogLevel.DEBUG);
    }

    logger.phase('データ検証');

    try {
      let config = await loadConfig(options.config);
      config = applyEnvironmentOverrides(config);

      if (options.output) {
        config.settings.outputDir = options.output;
      }

      printConfigSummary(config);

      await runVerification(config);
    } catch (error) {
      logger.error(
        `検証中にエラー: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  });

/**
 * report コマンド: 移行準備レポートを生成
 */
program
  .command('report')
  .description('移行準備レポートを生成')
  .requiredOption('-c, --config <path>', '設定ファイルパス')
  .requiredOption('-d, --results-dir <dir>', '結果ディレクトリ')
  .option('-o, --output <dir>', '出力ディレクトリを上書き')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      logger.setLogLevel(LogLevel.DEBUG);
    }

    logger.phase('レポート生成');

    try {
      let config = await loadConfig(options.config);
      config = applyEnvironmentOverrides(config);

      if (options.output) {
        config.settings.outputDir = options.output;
      }

      // TODO: 結果ディレクトリから結果を読み込んでレポート生成
      logger.info('レポート生成機能は full コマンド内で自動実行されます');
    } catch (error) {
      logger.error(
        `レポート生成中にエラー: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  });

/**
 * full コマンド: すべてを一括実行
 */
program
  .command('full')
  .description('検出 → バックアップ → 検証 → レポート を一括実行')
  .requiredOption('-c, --config <path>', '設定ファイルパス')
  .option('-o, --output <dir>', '出力ディレクトリを上書き')
  .option('--dry-run', 'ドライラン（実際の変更なし）')
  .option('-v, --verbose', '詳細ログを出力')
  .action(async (options) => {
    if (options.verbose) {
      logger.setLogLevel(LogLevel.DEBUG);
    }

    logger.phase('移行準備 全自動実行');

    try {
      let config = await loadConfig(options.config);
      config = applyEnvironmentOverrides(config);

      if (options.dryRun) {
        config.settings.dryRun = true;
      }

      if (options.output) {
        config.settings.outputDir = options.output;
      }

      printConfigSummary(config);

      const results = await runFullMigration(config);

      // 最終サマリー
      printFinalSummary(results);

      if (results.errors.length > 0) {
        logger.warn(`${results.errors.length} 件のエラーが発生しました`);
        process.exit(1);
      }
    } catch (error) {
      logger.error(
        `実行中にエラー: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  });

/**
 * init コマンド: サンプル設定ファイルを生成
 */
program
  .command('init')
  .description('サンプル設定ファイルを生成')
  .option('-o, --output <path>', '出力パス', './migration-config.json')
  .action(async (options) => {
    try {
      await generateSampleConfig(options.output);
      logger.info('設定ファイルを編集して、環境情報を設定してください');
    } catch (error) {
      logger.error(
        `生成中にエラー: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  });

/**
 * バックアップ処理を実行
 */
async function runBackup(config: MigrationConfig): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const backupDir = path.join(config.settings.outputDir, 'backups', timestamp);

  for (const envConfig of config.environments) {
    logger.section(`環境: ${envConfig.name}`);

    const awsConfig: AWSClientConfig = {
      region: envConfig.region,
      profile: envConfig.awsProfile,
    };

    // 環境検出
    const environments = await discoverEnvironments(awsConfig);
    const env = environments.find((e) => e.name === envConfig.name);

    if (!env) {
      logger.warn(`環境 ${envConfig.name} が見つかりませんでした`);
      continue;
    }

    // デフォルトテナントのバックアップ
    if (env.chatHistoryTableName) {
      logger.processing('デフォルトテナントのバックアップ...');

      const defaultBackupDir = path.join(backupDir, envConfig.name, 'default');

      // SystemContext エクスポート
      if (config.settings.tables.includeData.systemContexts) {
        const systemContextBackup = await exportDefaultTenantSystemContexts(
          awsConfig,
          env.chatHistoryTableName,
          envConfig.name
        );
        await saveSystemContextBackup(
          systemContextBackup,
          path.join(defaultBackupDir, 'systemContexts.json')
        );
        printSystemContextSummary(systemContextBackup);
      }

      // オンデマンドバックアップ
      if (config.settings.tables.createOnDemandBackups) {
        const tableNames = [
          env.chatHistoryTableName,
          env.tokenUsageStatsTableName,
          env.useCaseBuilderTableName,
        ].filter(Boolean) as string[];

        const backupResults = await backupDefaultTenantTables(
          awsConfig,
          tableNames,
          config.settings.dryRun
        );
        await saveBackupResults(
          backupResults,
          path.join(defaultBackupDir, 'dynamodb-backups.json')
        );
        printBackupSummary(backupResults);
      }
    }

    // テナントのバックアップ
    if (env.tenantsTableName) {
      let tenants = await discoverTenants(
        awsConfig,
        env.tenantsTableName,
        envConfig.name
      );

      tenants = filterActiveTenants(tenants);

      if (envConfig.excludeTenants) {
        tenants = excludeTenants(tenants, envConfig.excludeTenants);
      }

      for (const tenant of tenants) {
        if (isDefaultTenant(tenant.tenantId)) {
          continue;
        }

        logger.processing(`テナント: ${tenant.tenantId}`);

        const tenantBackupDir = path.join(
          backupDir,
          envConfig.name,
          `tenant-${tenant.tenantId}`
        );

        try {
          // SystemContext エクスポート
          if (config.settings.tables.includeData.systemContexts) {
            const systemContextBackup = await exportTenantSystemContexts(
              awsConfig,
              tenant
            );
            await saveSystemContextBackup(
              systemContextBackup,
              path.join(tenantBackupDir, 'systemContexts.json')
            );
          }

          // オンデマンドバックアップ
          if (config.settings.tables.createOnDemandBackups) {
            const backupResults = await backupTenantTables(
              awsConfig,
              tenant,
              config.settings.dryRun
            );
            await saveBackupResults(
              backupResults,
              path.join(tenantBackupDir, 'dynamodb-backups.json')
            );
          }
        } catch (error) {
          logger.error(
            `テナント ${tenant.tenantId} のバックアップに失敗: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }
}

/**
 * 検証処理を実行
 */
async function runVerification(config: MigrationConfig): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const verifyDir = path.join(config.settings.outputDir, 'verification', timestamp);

  for (const envConfig of config.environments) {
    logger.section(`環境: ${envConfig.name}`);

    const awsConfig: AWSClientConfig = {
      region: envConfig.region,
      profile: envConfig.awsProfile,
    };

    const environments = await discoverEnvironments(awsConfig);
    const env = environments.find((e) => e.name === envConfig.name);

    if (!env) {
      logger.warn(`環境 ${envConfig.name} が見つかりませんでした`);
      continue;
    }

    // デフォルトテナントのカウント
    if (env.chatHistoryTableName) {
      const tableNames = [
        env.chatHistoryTableName,
        env.tokenUsageStatsTableName,
        env.useCaseBuilderTableName,
      ].filter(Boolean) as string[];

      const counts = await countDefaultTenantTables(
        awsConfig,
        tableNames,
        env.chatHistoryTableName
      );
      await saveCountResults(
        counts,
        path.join(verifyDir, envConfig.name, 'default', 'counts.json')
      );
      printCountSummary(counts);
    }
  }
}

/**
 * 全自動移行処理を実行
 */
async function runFullMigration(config: MigrationConfig): Promise<MigrationResults> {
  const results = initializeResults(config);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const outputDir = path.join(config.settings.outputDir, timestamp);

  try {
    // Phase 1: 環境・テナント検出
    logger.phase('Phase 1: 環境・テナント検出');

    for (const envConfig of config.environments) {
      logger.section(`環境: ${envConfig.name}`);

      const awsConfig: AWSClientConfig = {
        region: envConfig.region,
        profile: envConfig.awsProfile,
      };

      try {
        const environments = await discoverEnvironments(awsConfig);
        results.environments.push(...environments);

        const env = environments.find((e) => e.name === envConfig.name);
        if (env?.tenantsTableName) {
          let tenants = await discoverTenants(
            awsConfig,
            env.tenantsTableName,
            envConfig.name
          );

          if (envConfig.excludeTenants) {
            tenants = excludeTenants(tenants, envConfig.excludeTenants);
          }

          results.tenants.push(...tenants);
        }
      } catch (error) {
        addError(results, 'discovery', error as Error, envConfig.name);
      }
    }

    await saveEnvironmentsToFile(
      results.environments,
      path.join(outputDir, 'discovery', 'environments.json')
    );
    await saveTenantsToFile(
      results.tenants,
      path.join(outputDir, 'discovery', 'tenants.json')
    );

    // Phase 2: バックアップ
    logger.phase('Phase 2: バックアップ');

    for (const envConfig of config.environments) {
      const awsConfig: AWSClientConfig = {
        region: envConfig.region,
        profile: envConfig.awsProfile,
      };

      const env = results.environments.find((e) => e.name === envConfig.name);
      if (!env) continue;

      // デフォルトテナント
      if (env.chatHistoryTableName) {
        try {
          const manifest: BackupManifest = {
            tenantId: 'default',
            environment: envConfig.name,
            createdAt: new Date().toISOString(),
            dynamoDbBackups: [],
            jsonExports: [],
          };

          if (config.settings.tables.createOnDemandBackups) {
            const tableNames = [
              env.chatHistoryTableName,
              env.tokenUsageStatsTableName,
              env.useCaseBuilderTableName,
            ].filter(Boolean) as string[];

            manifest.dynamoDbBackups = await backupDefaultTenantTables(
              awsConfig,
              tableNames,
              config.settings.dryRun
            );
          }

          results.backups.push(manifest);
        } catch (error) {
          addError(results, 'backup', error as Error, envConfig.name, 'default');
        }
      }

      // テナント
      const envTenants = results.tenants.filter(
        (t) => t.environment === envConfig.name && !isDefaultTenant(t.tenantId)
      );

      for (const tenant of filterActiveTenants(envTenants)) {
        try {
          const manifest: BackupManifest = {
            tenantId: tenant.tenantId,
            environment: envConfig.name,
            createdAt: new Date().toISOString(),
            dynamoDbBackups: [],
            jsonExports: [],
          };

          if (config.settings.tables.createOnDemandBackups) {
            manifest.dynamoDbBackups = await backupTenantTables(
              awsConfig,
              tenant,
              config.settings.dryRun
            );
          }

          results.backups.push(manifest);
        } catch (error) {
          addError(results, 'backup', error as Error, envConfig.name, tenant.tenantId);
        }
      }
    }

    // Phase 3: 検証
    logger.phase('Phase 3: 検証');

    for (const envConfig of config.environments) {
      const awsConfig: AWSClientConfig = {
        region: envConfig.region,
        profile: envConfig.awsProfile,
      };

      const env = results.environments.find((e) => e.name === envConfig.name);
      if (!env?.chatHistoryTableName) continue;

      try {
        const tableNames = [
          env.chatHistoryTableName,
          env.tokenUsageStatsTableName,
          env.useCaseBuilderTableName,
        ].filter(Boolean) as string[];

        const counts = await countDefaultTenantTables(
          awsConfig,
          tableNames,
          env.chatHistoryTableName
        );
        results.tableCounts.push(...counts);
      } catch (error) {
        addError(results, 'verification', error as Error, envConfig.name);
      }
    }

    // Phase 4: レポート生成
    logger.phase('Phase 4: レポート生成');

    finalizeResults(results);

    const report = generateReport(results);
    const { markdownPath, jsonPath } = await saveReport(
      report,
      path.join(outputDir, 'reports')
    );

    logger.success(`レポートを生成しました:`);
    logger.info(`  Markdown: ${markdownPath}`);
    logger.info(`  JSON: ${jsonPath}`);

  } catch (error) {
    addError(results, 'report', error as Error);
  }

  return results;
}

// CLI 実行
program.parse();
