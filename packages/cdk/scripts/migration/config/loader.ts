/**
 * 設定ローダーモジュール
 * 設定ファイルの読み込みとバリデーション
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { MigrationConfig, EnvironmentConfig, MigrationSettings } from './types';
import { logger } from '../utils/logger';

/**
 * デフォルト設定
 */
const DEFAULT_SETTINGS: MigrationSettings = {
  dryRun: false,
  outputDir: './migration-output',
  parallelism: 3,
  tables: {
    createOnDemandBackups: true,
    exportToJson: true,
    includeData: {
      systemContexts: true,
      chatHistory: true,
      tokenUsageStats: true,
      useCaseBuilder: true,
    },
  },
};

/**
 * 設定ファイルを読み込む
 */
export async function loadConfig(configPath: string): Promise<MigrationConfig> {
  const absolutePath = path.resolve(configPath);

  logger.info(`設定ファイルを読み込み中: ${absolutePath}`);

  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    const config = JSON.parse(content) as Partial<MigrationConfig>;

    // バリデーションと補完
    const validatedConfig = validateAndMergeDefaults(config);

    logger.success('設定ファイルの読み込み完了');
    logger.debug(`  環境数: ${validatedConfig.environments.length}`);
    logger.debug(`  ドライラン: ${validatedConfig.settings.dryRun}`);

    return validatedConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`設定ファイルが見つかりません: ${absolutePath}`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`設定ファイルの JSON パースに失敗: ${error.message}`);
    }

    throw error;
  }
}

/**
 * 設定をバリデーションしてデフォルト値をマージ
 */
function validateAndMergeDefaults(
  config: Partial<MigrationConfig>
): MigrationConfig {
  // 必須フィールドのチェック
  if (!config.sourceVersion) {
    throw new Error('設定エラー: sourceVersion は必須です');
  }

  if (!config.targetVersion) {
    throw new Error('設定エラー: targetVersion は必須です');
  }

  if (!config.environments || config.environments.length === 0) {
    throw new Error('設定エラー: environments は1つ以上必要です');
  }

  // 環境設定のバリデーション
  for (const env of config.environments) {
    validateEnvironmentConfig(env);
  }

  // デフォルト設定とマージ
  const settings: MigrationSettings = {
    ...DEFAULT_SETTINGS,
    ...config.settings,
    tables: {
      ...DEFAULT_SETTINGS.tables,
      ...config.settings?.tables,
      includeData: {
        ...DEFAULT_SETTINGS.tables.includeData,
        ...config.settings?.tables?.includeData,
      },
    },
  };

  return {
    sourceVersion: config.sourceVersion,
    targetVersion: config.targetVersion,
    environments: config.environments,
    settings,
  };
}

/**
 * 環境設定をバリデーション
 */
function validateEnvironmentConfig(env: EnvironmentConfig): void {
  if (!env.name) {
    throw new Error('設定エラー: 環境の name は必須です');
  }

  if (!env.region) {
    throw new Error(`設定エラー: 環境 ${env.name} の region は必須です`);
  }

  // リージョン形式のチェック（簡易）
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(env.region)) {
    logger.warn(
      `環境 ${env.name} のリージョン形式が不正な可能性があります: ${env.region}`
    );
  }
}

/**
 * サンプル設定ファイルを生成
 */
export async function generateSampleConfig(outputPath: string): Promise<void> {
  const sampleConfig: MigrationConfig = {
    sourceVersion: 'v0.5.3',
    targetVersion: 'develop',
    environments: [
      {
        name: 'dev',
        region: 'us-east-1',
        awsProfile: 'genu-dev',
      },
      {
        name: 'prod',
        region: 'us-east-1',
        awsProfile: 'genu-prod',
        excludeTenants: ['test-tenant'],
      },
    ],
    settings: DEFAULT_SETTINGS,
  };

  await fs.writeFile(
    outputPath,
    JSON.stringify(sampleConfig, null, 2),
    'utf-8'
  );

  logger.success(`サンプル設定ファイルを生成: ${outputPath}`);
}

/**
 * 設定のサマリーを表示
 */
export function printConfigSummary(config: MigrationConfig): void {
  logger.summary('設定サマリー', {
    '移行元': config.sourceVersion,
    '移行先': config.targetVersion,
    '環境数': config.environments.length,
    'ドライラン': config.settings.dryRun ? 'はい' : 'いいえ',
    '並列度': config.settings.parallelism,
    '出力先': config.settings.outputDir,
  });

  logger.info('環境一覧:');
  for (const env of config.environments) {
    logger.info(
      `  - ${env.name}: ${env.region} (profile: ${env.awsProfile ?? 'default'})`
    );
    if (env.excludeTenants && env.excludeTenants.length > 0) {
      logger.info(`    除外テナント: ${env.excludeTenants.join(', ')}`);
    }
  }
}

/**
 * 設定を環境変数で上書き
 */
export function applyEnvironmentOverrides(
  config: MigrationConfig
): MigrationConfig {
  const overrides: Partial<MigrationSettings> = {};

  // DRY_RUN 環境変数
  if (process.env.MIGRATION_DRY_RUN === 'true') {
    overrides.dryRun = true;
    logger.info('環境変数により dryRun=true に設定');
  }

  // OUTPUT_DIR 環境変数
  if (process.env.MIGRATION_OUTPUT_DIR) {
    overrides.outputDir = process.env.MIGRATION_OUTPUT_DIR;
    logger.info(`環境変数により outputDir=${overrides.outputDir} に設定`);
  }

  // PARALLELISM 環境変数
  if (process.env.MIGRATION_PARALLELISM) {
    const parallelism = parseInt(process.env.MIGRATION_PARALLELISM, 10);
    if (!isNaN(parallelism) && parallelism > 0) {
      overrides.parallelism = parallelism;
      logger.info(`環境変数により parallelism=${parallelism} に設定`);
    }
  }

  return {
    ...config,
    settings: {
      ...config.settings,
      ...overrides,
    },
  };
}
