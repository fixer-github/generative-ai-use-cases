/**
 * Configuration Loader
 * 設定ファイルの読み込みと検証
 */

import * as fs from 'fs';
import * as path from 'path';
import { MigrationConfig, MigrationSettings, EnvironmentConfig } from './types';

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
 * @param configPath 設定ファイルのパス
 * @returns 移行設定
 */
export function loadConfig(configPath: string): MigrationConfig {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`設定ファイルが見つかりません: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  let rawConfig: unknown;

  try {
    rawConfig = JSON.parse(content);
  } catch (error) {
    throw new Error(`設定ファイルのパースに失敗しました: ${error}`);
  }

  return validateAndNormalizeConfig(rawConfig);
}

/**
 * 設定を検証して正規化する
 * @param raw 生の設定オブジェクト
 * @returns 正規化された設定
 */
function validateAndNormalizeConfig(raw: unknown): MigrationConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('設定ファイルはオブジェクトである必要があります');
  }

  const config = raw as Record<string, unknown>;

  // 必須フィールドの検証
  if (typeof config.sourceVersion !== 'string') {
    throw new Error('sourceVersion は必須です');
  }

  if (typeof config.targetVersion !== 'string') {
    throw new Error('targetVersion は必須です');
  }

  if (!Array.isArray(config.environments) || config.environments.length === 0) {
    throw new Error('environments は1つ以上の環境を含む必要があります');
  }

  // 環境設定の検証
  const environments = config.environments.map((env, index) =>
    validateEnvironmentConfig(env, index)
  );

  // 設定のマージ
  const settings = mergeSettings(config.settings as Partial<MigrationSettings>);

  return {
    sourceVersion: config.sourceVersion,
    targetVersion: config.targetVersion,
    environments,
    settings,
  };
}

/**
 * 環境設定を検証する
 * @param env 環境設定
 * @param index インデックス
 * @returns 検証済みの環境設定
 */
function validateEnvironmentConfig(
  env: unknown,
  index: number
): EnvironmentConfig {
  if (!env || typeof env !== 'object') {
    throw new Error(`environments[${index}] はオブジェクトである必要があります`);
  }

  const envConfig = env as Record<string, unknown>;

  if (typeof envConfig.name !== 'string' || envConfig.name.trim() === '') {
    throw new Error(`environments[${index}].name は必須です`);
  }

  if (typeof envConfig.region !== 'string' || envConfig.region.trim() === '') {
    throw new Error(`environments[${index}].region は必須です`);
  }

  const excludeTenants = Array.isArray(envConfig.excludeTenants)
    ? envConfig.excludeTenants.filter(
        (t): t is string => typeof t === 'string'
      )
    : [];

  return {
    name: envConfig.name.trim(),
    region: envConfig.region.trim(),
    awsProfile:
      typeof envConfig.awsProfile === 'string'
        ? envConfig.awsProfile.trim()
        : undefined,
    excludeTenants,
  };
}

/**
 * 設定をデフォルト値とマージする
 * @param partial 部分的な設定
 * @returns マージされた設定
 */
function mergeSettings(partial?: Partial<MigrationSettings>): MigrationSettings {
  if (!partial) {
    return DEFAULT_SETTINGS;
  }

  return {
    dryRun: partial.dryRun ?? DEFAULT_SETTINGS.dryRun,
    outputDir: partial.outputDir ?? DEFAULT_SETTINGS.outputDir,
    parallelism: partial.parallelism ?? DEFAULT_SETTINGS.parallelism,
    tables: {
      createOnDemandBackups:
        partial.tables?.createOnDemandBackups ??
        DEFAULT_SETTINGS.tables.createOnDemandBackups,
      exportToJson:
        partial.tables?.exportToJson ?? DEFAULT_SETTINGS.tables.exportToJson,
      includeData: {
        systemContexts:
          partial.tables?.includeData?.systemContexts ??
          DEFAULT_SETTINGS.tables.includeData.systemContexts,
        chatHistory:
          partial.tables?.includeData?.chatHistory ??
          DEFAULT_SETTINGS.tables.includeData.chatHistory,
        tokenUsageStats:
          partial.tables?.includeData?.tokenUsageStats ??
          DEFAULT_SETTINGS.tables.includeData.tokenUsageStats,
        useCaseBuilder:
          partial.tables?.includeData?.useCaseBuilder ??
          DEFAULT_SETTINGS.tables.includeData.useCaseBuilder,
      },
    },
  };
}

/**
 * サンプル設定ファイルを生成する
 * @returns サンプル設定のJSON文字列
 */
export function generateSampleConfig(): string {
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

  return JSON.stringify(sampleConfig, null, 2);
}

/**
 * 出力ディレクトリを準備する
 * @param outputDir 出力ディレクトリパス
 */
export function prepareOutputDirectory(outputDir: string): void {
  const absolutePath = path.resolve(outputDir);

  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
  }

  // サブディレクトリを作成
  const subDirs = ['discovery', 'backups', 'verification', 'reports'];
  for (const subDir of subDirs) {
    const subDirPath = path.join(absolutePath, subDir);
    if (!fs.existsSync(subDirPath)) {
      fs.mkdirSync(subDirPath, { recursive: true });
    }
  }
}

/**
 * タイムスタンプ付きディレクトリを作成する
 * @param baseDir ベースディレクトリ
 * @returns 作成されたディレクトリパス
 */
export function createTimestampedDirectory(baseDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dirPath = path.join(baseDir, timestamp);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return dirPath;
}
