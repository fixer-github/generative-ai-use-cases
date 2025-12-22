/**
 * Progress Utility
 * 進捗表示ユーティリティ
 */

/**
 * 進捗バーを作成する
 */
export class ProgressBar {
  private total: number;
  private current: number;
  private label: string;
  private barWidth: number;
  private startTime: number;

  constructor(total: number, label: string = '', barWidth: number = 40) {
    this.total = total;
    this.current = 0;
    this.label = label;
    this.barWidth = barWidth;
    this.startTime = Date.now();
  }

  /**
   * 進捗を更新する
   */
  update(current: number, message?: string): void {
    this.current = current;
    this.render(message);
  }

  /**
   * 進捗をインクリメントする
   */
  increment(message?: string): void {
    this.current++;
    this.render(message);
  }

  /**
   * 進捗バーを描画する
   */
  private render(message?: string): void {
    const percentage = Math.min(100, Math.floor((this.current / this.total) * 100));
    const filled = Math.floor((this.current / this.total) * this.barWidth);
    const empty = this.barWidth - filled;
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const eta = this.current > 0
      ? (((Date.now() - this.startTime) / this.current) * (this.total - this.current) / 1000).toFixed(1)
      : '?';

    const statusLine = message ? ` - ${message}` : '';
    const output = `\r${this.label} [${bar}] ${percentage}% (${this.current}/${this.total}) | ${elapsed}s / ETA: ${eta}s${statusLine}`;

    process.stdout.write(output.padEnd(120));

    if (this.current >= this.total) {
      process.stdout.write('\n');
    }
  }

  /**
   * 完了する
   */
  complete(message?: string): void {
    this.current = this.total;
    this.render(message || '完了');
  }
}

/**
 * スピナーを作成する
 */
export class Spinner {
  private frames: string[];
  private currentFrame: number;
  private interval: NodeJS.Timeout | null;
  private message: string;
  private isRunning: boolean;

  constructor(message: string = '') {
    this.frames = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
    this.currentFrame = 0;
    this.interval = null;
    this.message = message;
    this.isRunning = false;
  }

  /**
   * スピナーを開始する
   */
  start(message?: string): void {
    if (this.isRunning) return;

    if (message) {
      this.message = message;
    }

    this.isRunning = true;
    this.interval = setInterval(() => {
      const frame = this.frames[this.currentFrame];
      process.stdout.write(`\r${frame} ${this.message}`);
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }, 80);
  }

  /**
   * メッセージを更新する
   */
  updateMessage(message: string): void {
    this.message = message;
  }

  /**
   * スピナーを停止する
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  /**
   * 成功で停止する
   */
  succeed(message?: string): void {
    this.stop();
    console.log(`\x1b[32m\u2714\x1b[0m ${message || this.message}`);
  }

  /**
   * 失敗で停止する
   */
  fail(message?: string): void {
    this.stop();
    console.log(`\x1b[31m\u2718\x1b[0m ${message || this.message}`);
  }

  /**
   * 警告で停止する
   */
  warn(message?: string): void {
    this.stop();
    console.log(`\x1b[33m\u26A0\x1b[0m ${message || this.message}`);
  }

  /**
   * 情報で停止する
   */
  info(message?: string): void {
    this.stop();
    console.log(`\x1b[36m\u2139\x1b[0m ${message || this.message}`);
  }
}

/**
 * 非同期処理を並列実行する（並列数制限付き）
 */
export async function parallelRun<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 3,
  progressLabel?: string
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const progress = progressLabel
    ? new ProgressBar(items.length, progressLabel)
    : null;

  let currentIndex = 0;
  let completedCount = 0;

  const runNext = async (): Promise<void> => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];

      try {
        results[index] = await fn(item, index);
      } catch (error) {
        console.error(`Error processing item at index ${index}:`, error);
        throw error;
      }

      completedCount++;
      if (progress) {
        progress.update(completedCount);
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    runNext()
  );

  await Promise.all(workers);

  if (progress) {
    progress.complete();
  }

  return results;
}

/**
 * リトライ付きで非同期処理を実行する
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    onRetry,
  } = options;

  let lastError: unknown;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt <= maxRetries) {
        if (onRetry) {
          onRetry(attempt, error);
        }
        await sleep(currentDelay);
        currentDelay *= backoffMultiplier;
      }
    }
  }

  throw lastError;
}

/**
 * 指定時間待機する
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
