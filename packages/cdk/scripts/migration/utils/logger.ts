/**
 * Logger Utility
 * ロギングユーティリティ
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
}

let currentConfig: LoggerConfig = {
  level: LogLevel.INFO,
};

/**
 * ロガーを設定する
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * 詳細ログを有効にする
 */
export function enableVerbose(): void {
  currentConfig.level = LogLevel.DEBUG;
}

/**
 * タイムスタンプを取得する
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * ログプレフィックスを取得する
 */
function getPrefix(): string {
  return currentConfig.prefix ? `[${currentConfig.prefix}] ` : '';
}

/**
 * デバッグログを出力する
 */
export function debug(message: string, ...args: unknown[]): void {
  if (currentConfig.level <= LogLevel.DEBUG) {
    console.log(
      `\x1b[90m${getTimestamp()} [DEBUG] ${getPrefix()}${message}\x1b[0m`,
      ...args
    );
  }
}

/**
 * 情報ログを出力する
 */
export function info(message: string, ...args: unknown[]): void {
  if (currentConfig.level <= LogLevel.INFO) {
    console.log(
      `\x1b[36m${getTimestamp()} [INFO] ${getPrefix()}${message}\x1b[0m`,
      ...args
    );
  }
}

/**
 * 成功ログを出力する
 */
export function success(message: string, ...args: unknown[]): void {
  if (currentConfig.level <= LogLevel.INFO) {
    console.log(
      `\x1b[32m${getTimestamp()} [SUCCESS] ${getPrefix()}${message}\x1b[0m`,
      ...args
    );
  }
}

/**
 * 警告ログを出力する
 */
export function warn(message: string, ...args: unknown[]): void {
  if (currentConfig.level <= LogLevel.WARN) {
    console.warn(
      `\x1b[33m${getTimestamp()} [WARN] ${getPrefix()}${message}\x1b[0m`,
      ...args
    );
  }
}

/**
 * エラーログを出力する
 */
export function error(message: string, ...args: unknown[]): void {
  if (currentConfig.level <= LogLevel.ERROR) {
    console.error(
      `\x1b[31m${getTimestamp()} [ERROR] ${getPrefix()}${message}\x1b[0m`,
      ...args
    );
  }
}

/**
 * セクションヘッダーを出力する
 */
export function section(title: string): void {
  if (currentConfig.level <= LogLevel.INFO) {
    const line = '='.repeat(60);
    console.log(`\n\x1b[34m${line}\x1b[0m`);
    console.log(`\x1b[34m  ${title}\x1b[0m`);
    console.log(`\x1b[34m${line}\x1b[0m\n`);
  }
}

/**
 * サブセクションヘッダーを出力する
 */
export function subsection(title: string): void {
  if (currentConfig.level <= LogLevel.INFO) {
    const line = '-'.repeat(40);
    console.log(`\n\x1b[35m${line}\x1b[0m`);
    console.log(`\x1b[35m  ${title}\x1b[0m`);
    console.log(`\x1b[35m${line}\x1b[0m\n`);
  }
}

/**
 * テーブルを出力する
 */
export function table(data: Record<string, unknown>[]): void {
  if (currentConfig.level <= LogLevel.INFO) {
    console.table(data);
  }
}

/**
 * JSONを出力する
 */
export function json(data: unknown): void {
  if (currentConfig.level <= LogLevel.INFO) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * 空行を出力する
 */
export function newLine(): void {
  if (currentConfig.level <= LogLevel.INFO) {
    console.log();
  }
}

/**
 * ドライラン警告を出力する
 */
export function dryRunWarning(): void {
  warn('================================================');
  warn('  ドライランモードで実行中です');
  warn('  実際の変更は行われません');
  warn('================================================');
}

/**
 * 処理開始メッセージを出力する
 */
export function startProcess(name: string): void {
  info(`>>> ${name} を開始します...`);
}

/**
 * 処理完了メッセージを出力する
 */
export function endProcess(name: string, duration?: number): void {
  const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}秒)` : '';
  success(`<<< ${name} が完了しました${durationStr}`);
}

/**
 * 処理スキップメッセージを出力する
 */
export function skipProcess(name: string, reason: string): void {
  warn(`--- ${name} をスキップしました: ${reason}`);
}

/**
 * 処理失敗メッセージを出力する
 */
export function failProcess(name: string, err: unknown): void {
  error(`!!! ${name} が失敗しました:`, err);
}
