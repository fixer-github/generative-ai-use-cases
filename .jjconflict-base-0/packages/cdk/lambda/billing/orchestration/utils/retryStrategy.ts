/**
 * Retry Strategy Utility
 *
 * Provides retry logic with exponential backoff for handling transient failures.
 * This module implements retry strategies commonly used in distributed systems.
 */

/**
 * Base delay for exponential backoff in milliseconds
 */
const BASE_DELAY_MS = 2000;

/**
 * Maximum delay for exponential backoff in milliseconds
 */
const MAX_DELAY_MS = 300000; // 5 minutes

/**
 * Default maximum number of retries
 */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * 指数バックオフでの待機時間を計算
 *
 * 基数2秒、最大バックオフ300秒の指数バックオフを実装します。
 * 計算式: min(BASE_DELAY_MS * 2^attemptNumber, MAX_DELAY_MS)
 *
 * @param attemptNumber - リトライ回数（0から開始）
 * @returns 待機時間（ミリ秒）
 *
 * @example
 * ```typescript
 * calculateBackoffDelay(0) // 2000ms (2秒)
 * calculateBackoffDelay(1) // 4000ms (4秒)
 * calculateBackoffDelay(2) // 8000ms (8秒)
 * calculateBackoffDelay(10) // 300000ms (5分、上限)
 * ```
 */
export function calculateBackoffDelay(attemptNumber: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attemptNumber);
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * 最大リトライ回数に達したかチェック
 *
 * @param attemptNumber - 現在のリトライ回数（0から開始）
 * @param maxRetries - 最大リトライ回数
 * @returns リトライ可能な場合はtrue
 *
 * @example
 * ```typescript
 * shouldRetry(0, 3) // true (初回実行)
 * shouldRetry(2, 3) // true (まだリトライ可能)
 * shouldRetry(3, 3) // false (最大回数に達した)
 * ```
 */
export function shouldRetry(attemptNumber: number, maxRetries: number): boolean {
  return attemptNumber < maxRetries;
}

/**
 * エラーがリトライ可能かどうかを判定
 *
 * 以下のエラーをリトライ可能と判断します：
 * - ネットワークエラー（ECONNRESET, ETIMEDOUT, ENOTFOUND等）
 * - タイムアウトエラー
 * - 一時的なサービスエラー（503等）
 * - スロットリングエラー
 *
 * @param error - チェック対象のエラー
 * @returns リトライ可能な場合はtrue
 *
 * @example
 * ```typescript
 * const networkError = new Error('ECONNRESET');
 * isRetryableError(networkError) // true
 *
 * const validationError = new Error('Invalid input');
 * isRetryableError(validationError) // false
 * ```
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // ネットワーク関連のエラー
  const networkErrors = [
    'econnreset',
    'etimedout',
    'enotfound',
    'econnrefused',
    'network',
  ];
  if (networkErrors.some((errType) => message.includes(errType))) {
    return true;
  }

  // タイムアウトエラー
  if (message.includes('timeout')) {
    return true;
  }

  // サービス一時利用不可
  if (message.includes('503') || message.includes('service unavailable')) {
    return true;
  }

  // スロットリングエラー
  if (
    message.includes('throttl') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return true;
  }

  // DynamoDB関連のリトライ可能エラー
  if (
    message.includes('provisionedthroughputexceeded') ||
    message.includes('throughput exceeded')
  ) {
    return true;
  }

  // その他の一時的エラー
  if (message.includes('temporary') || message.includes('transient')) {
    return true;
  }

  return false;
}

/**
 * リトライオプション
 */
export interface RetryOptions {
  /** 最大リトライ回数 */
  maxRetries: number;

  /** カスタムリトライ可能エラーチェッカー */
  retryableErrorChecker?: (error: Error) => boolean;

  /** リトライ時のコールバック */
  onRetry?: (attemptNumber: number, error: Error) => void;
}

/**
 * リトライ付きで関数を実行
 *
 * 指定された関数を実行し、失敗時には指数バックオフでリトライします。
 * リトライ可能なエラーの場合のみリトライを実行します。
 *
 * @param fn - 実行する非同期関数
 * @param options - リトライオプション
 * @returns 関数の実行結果
 * @throws {Error} 最大リトライ回数に達した場合、または非リトライ可能エラーの場合
 *
 * @example
 * ```typescript
 * const result = await executeWithRetry(
 *   async () => {
 *     return await someApiCall();
 *   },
 *   {
 *     maxRetries: 3,
 *     onRetry: (attempt, error) => {
 *       console.log(`Retry attempt ${attempt}: ${error.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, retryableErrorChecker, onRetry } = options;
  let attemptNumber = 0;
  let lastError: Error;

  while (attemptNumber <= maxRetries) {
    try {
      // 関数を実行
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最大リトライ回数に達した場合はエラーを投げる
      if (!shouldRetry(attemptNumber, maxRetries)) {
        console.error('Maximum retry attempts reached', {
          attemptNumber,
          maxRetries,
          error: lastError.message,
        });
        throw lastError;
      }

      // リトライ可能かチェック
      const checker = retryableErrorChecker || isRetryableError;
      const canRetry = checker(lastError);

      if (!canRetry) {
        console.error('Non-retryable error occurred', {
          attemptNumber,
          error: lastError.message,
        });
        throw lastError;
      }

      // リトライコールバックを呼び出し
      if (onRetry) {
        onRetry(attemptNumber, lastError);
      }

      // バックオフ待機
      const delayMs = calculateBackoffDelay(attemptNumber);
      console.log('Retrying after delay', {
        attemptNumber,
        delayMs,
        error: lastError.message,
      });

      await sleep(delayMs);
      attemptNumber++;
    }
  }

  throw lastError!;
}

/**
 * 指定されたミリ秒数だけ待機する
 *
 * @param ms - 待機時間（ミリ秒）
 * @returns Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
