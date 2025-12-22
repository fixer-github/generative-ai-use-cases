/**
 * リトライロジックユーティリティ
 * AWS API呼び出しのリトライ処理に対応
 */

import { logger } from './logger';

export interface RetryOptions {
  /** 最大リトライ回数 */
  maxRetries: number;
  /** 初回待機時間（ミリ秒） */
  initialDelayMs: number;
  /** 最大待機時間（ミリ秒） */
  maxDelayMs: number;
  /** 指数バックオフの係数 */
  backoffMultiplier: number;
  /** リトライ対象のエラー判定関数 */
  isRetryable?: (error: unknown) => boolean;
  /** リトライ時のコールバック */
  onRetry?: (attempt: number, error: unknown) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * AWS エラーがリトライ可能かどうかを判定
 */
export function isRetryableAWSError(error: unknown): boolean {
  if (error instanceof Error) {
    const errorName = (error as { name?: string }).name ?? '';
    const errorCode = (error as { code?: string }).code ?? '';

    // スロットリング関連
    if (
      errorName === 'ThrottlingException' ||
      errorName === 'ProvisionedThroughputExceededException' ||
      errorCode === 'Throttling' ||
      errorCode === 'ThrottlingException'
    ) {
      return true;
    }

    // サービス一時障害
    if (
      errorName === 'ServiceUnavailable' ||
      errorName === 'InternalServerError' ||
      errorCode === '503' ||
      errorCode === '500'
    ) {
      return true;
    }

    // ネットワーク関連
    if (
      errorName === 'TimeoutError' ||
      errorName === 'NetworkingError' ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ETIMEDOUT')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 指数バックオフで待機時間を計算
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  // ジッターを追加して同時リトライを分散
  const jitter = Math.random() * 0.3 + 0.85; // 0.85 - 1.15
  const delay = Math.min(
    initialDelayMs * Math.pow(backoffMultiplier, attempt - 1) * jitter,
    maxDelayMs
  );
  return Math.floor(delay);
}

/**
 * 指定時間待機
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * リトライ付きで関数を実行
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  const isRetryable = opts.isRetryable ?? isRetryableAWSError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 最後の試行または、リトライ不可能なエラー
      if (attempt > opts.maxRetries || !isRetryable(error)) {
        throw error;
      }

      const delay = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier
      );

      logger.debug(
        `リトライ ${attempt}/${opts.maxRetries} (${delay}ms 後): ${error instanceof Error ? error.message : String(error)}`
      );

      if (opts.onRetry) {
        opts.onRetry(attempt, error);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * 並列実行の制限付きマッパー
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const promise = (async () => {
      results[i] = await fn(items[i], i);
    })();

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // 完了した promise を削除
      const doneIndex = executing.findIndex(
        (p) => p === Promise.resolve(p).then(() => p)
      );
      if (doneIndex >= 0) {
        executing.splice(doneIndex, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * シンプルな並列実行（制限付き）
 */
export async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workers = Array(Math.min(limit, tasks.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * 結果をまとめて成功・失敗を分離
 */
export interface SettledResult<T> {
  status: 'fulfilled' | 'rejected';
  value?: T;
  reason?: unknown;
}

export async function settleAll<T>(
  promises: Promise<T>[]
): Promise<SettledResult<T>[]> {
  return Promise.all(
    promises.map(async (p) => {
      try {
        const value = await p;
        return { status: 'fulfilled' as const, value };
      } catch (reason) {
        return { status: 'rejected' as const, reason };
      }
    })
  );
}

/**
 * タイムアウト付きで Promise を実行
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'タイムアウトしました'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
