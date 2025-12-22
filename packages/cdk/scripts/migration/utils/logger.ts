/**
 * ロギングユーティリティ
 * 日本語でのログ出力に対応
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerConfig {
  level: LogLevel;
  showTimestamp: boolean;
  showLevel: boolean;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  showTimestamp: true,
  showLevel: true,
};

let currentConfig: LoggerConfig = { ...DEFAULT_CONFIG };

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO ',
  [LogLevel.WARN]: 'WARN ',
  [LogLevel.ERROR]: 'ERROR',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '\x1b[90m', // グレー
  [LogLevel.INFO]: '\x1b[36m', // シアン
  [LogLevel.WARN]: '\x1b[33m', // 黄色
  [LogLevel.ERROR]: '\x1b[31m', // 赤
};

const RESET_COLOR = '\x1b[0m';

function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

function formatMessage(level: LogLevel, message: string): string {
  const parts: string[] = [];

  if (currentConfig.showTimestamp) {
    parts.push(`[${formatTimestamp()}]`);
  }

  if (currentConfig.showLevel) {
    const color = LEVEL_COLORS[level];
    parts.push(`${color}[${LEVEL_LABELS[level]}]${RESET_COLOR}`);
  }

  parts.push(message);

  return parts.join(' ');
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (level < currentConfig.level) {
    return;
  }

  const formattedMessage = formatMessage(level, message);

  if (args.length > 0) {
    console.log(formattedMessage, ...args);
  } else {
    console.log(formattedMessage);
  }
}

/**
 * ロガー設定を更新
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * ログレベルを設定
 */
export function setLogLevel(level: LogLevel): void {
  currentConfig.level = level;
}

/**
 * デバッグログを出力
 */
export function debug(message: string, ...args: unknown[]): void {
  log(LogLevel.DEBUG, message, ...args);
}

/**
 * 情報ログを出力
 */
export function info(message: string, ...args: unknown[]): void {
  log(LogLevel.INFO, message, ...args);
}

/**
 * 警告ログを出力
 */
export function warn(message: string, ...args: unknown[]): void {
  log(LogLevel.WARN, message, ...args);
}

/**
 * エラーログを出力
 */
export function error(message: string, ...args: unknown[]): void {
  log(LogLevel.ERROR, message, ...args);
}

/**
 * フェーズ開始ログを出力
 */
export function phase(phaseName: string): void {
  const separator = '='.repeat(60);
  console.log('');
  console.log(`\x1b[35m${separator}\x1b[0m`);
  console.log(`\x1b[35m  📋 ${phaseName}\x1b[0m`);
  console.log(`\x1b[35m${separator}\x1b[0m`);
}

/**
 * セクション開始ログを出力
 */
export function section(sectionName: string): void {
  const separator = '-'.repeat(40);
  console.log('');
  console.log(`\x1b[34m${separator}\x1b[0m`);
  console.log(`\x1b[34m  📁 ${sectionName}\x1b[0m`);
  console.log(`\x1b[34m${separator}\x1b[0m`);
}

/**
 * 成功ログを出力
 */
export function success(message: string): void {
  console.log(`\x1b[32m  ✅ ${message}\x1b[0m`);
}

/**
 * 失敗ログを出力
 */
export function failure(message: string): void {
  console.log(`\x1b[31m  ❌ ${message}\x1b[0m`);
}

/**
 * スキップログを出力
 */
export function skip(message: string): void {
  console.log(`\x1b[90m  ⏭️  ${message}\x1b[0m`);
}

/**
 * 処理中ログを出力
 */
export function processing(message: string): void {
  console.log(`\x1b[36m  🔄 ${message}\x1b[0m`);
}

/**
 * 完了サマリーを出力
 */
export function summary(
  title: string,
  stats: Record<string, number | string>
): void {
  const separator = '─'.repeat(40);
  console.log('');
  console.log(`\x1b[32m${separator}\x1b[0m`);
  console.log(`\x1b[32m  📊 ${title}\x1b[0m`);
  console.log(`\x1b[32m${separator}\x1b[0m`);

  for (const [key, value] of Object.entries(stats)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log(`\x1b[32m${separator}\x1b[0m`);
}

/**
 * ドライランメッセージを出力
 */
export function dryRun(message: string): void {
  console.log(`\x1b[33m  [DRY-RUN] ${message}\x1b[0m`);
}

/**
 * テーブル形式でデータを出力
 */
export function table(
  headers: string[],
  rows: (string | number)[][]
): void {
  // 各列の最大幅を計算
  const colWidths = headers.map((h, i) => {
    const maxRowWidth = Math.max(...rows.map((r) => String(r[i] ?? '').length));
    return Math.max(h.length, maxRowWidth);
  });

  // ヘッダー行を出力
  const headerRow = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join(' | ');
  const separator = colWidths.map((w) => '-'.repeat(w)).join('-+-');

  console.log(`  ${headerRow}`);
  console.log(`  ${separator}`);

  // データ行を出力
  for (const row of rows) {
    const rowStr = row
      .map((cell, i) => String(cell ?? '').padEnd(colWidths[i]))
      .join(' | ');
    console.log(`  ${rowStr}`);
  }
}

export const logger = {
  debug,
  info,
  warn,
  error,
  phase,
  section,
  success,
  failure,
  skip,
  processing,
  summary,
  dryRun,
  table,
  configureLogger,
  setLogLevel,
};

export default logger;
