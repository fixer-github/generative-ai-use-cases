/**
 * Payment Gateway Function Client
 *
 * 決済ゲートウェイ関数を呼び出すためのクライアント
 * - レシート検証
 * - サブスクリプション更新（プラン変更）
 * - サブスクリプションキャンセル
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

/**
 * レシート検証リクエストパラメータ
 */
export interface VerifyReceiptParams {
  /** プラットフォームタイプ（stripe、apple、google、オプション） */
  platformType?: 'stripe' | 'apple' | 'google';
  /** レシートデータ（Base64エンコードされた文字列） */
  receipt: string;
  /** サブスクリプションID（オプション） */
  subscriptionId?: string;
}

/**
 * レシート検証レスポンス
 */
export interface VerifyReceiptResponse {
  /** レシートが有効かどうか */
  isValid: boolean;
  /** プラットフォーム側のサブスクリプションID（オプション） */
  platformSubscriptionId?: string;
  /** プランID（オプション） */
  planId?: string;
  /** 有効期限（ISO 8601形式、オプション） */
  expiresAt?: string;
}

/**
 * サブスクリプション更新リクエストパラメータ
 */
export interface UpdateSubscriptionParams {
  /** プラットフォームタイプ（stripe、apple、google） */
  platform: 'stripe' | 'apple' | 'google';
  /** サブスクリプションID */
  subscriptionId: string;
  /** 新しいプランID */
  newPlanId: string;
  /** プロレート（日割り計算）を行うか */
  prorate: boolean;
}

/**
 * サブスクリプション更新レスポンス
 */
export interface UpdateSubscriptionResponse {
  /** 成功フラグ */
  success: boolean;
}

/**
 * サブスクリプションキャンセルリクエストパラメータ
 */
export interface CancelSubscriptionParams {
  /** プラットフォームタイプ（stripe、apple、google） */
  platform: 'stripe' | 'apple' | 'google';
  /** サブスクリプションID */
  subscriptionId: string;
  /** 期間終了時にキャンセルするか（true: 期間終了時、false: 即座） */
  atPeriodEnd: boolean;
}

/**
 * サブスクリプションキャンセルレスポンス
 */
export interface CancelSubscriptionResponse {
  /** 成功フラグ */
  success: boolean;
}

/**
 * Lambda呼び出しエラー
 */
export class PaymentGatewayClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'PaymentGatewayClientError';
  }
}

/**
 * Payment Gateway Function Client
 */
export class PaymentGatewayClient {
  private readonly lambdaClient: LambdaClient;
  private readonly maxRetries = 3;
  private readonly baseRetryDelayMs = 1000;

  constructor(client?: LambdaClient) {
    this.lambdaClient = client || new LambdaClient({});
  }

  /**
   * レシート検証
   *
   * プラットフォーム（Apple、Google）から受け取ったレシートを検証します。
   * レシートが有効な場合、サブスクリプション情報を返します。
   *
   * @param params レシート検証パラメータ
   * @returns レシート検証結果
   * @throws PaymentGatewayClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async verifyReceipt(
    params: VerifyReceiptParams
  ): Promise<VerifyReceiptResponse> {
    const functionName = process.env.PAYMENT_GATEWAY_VERIFY_RECEIPT_FUNCTION_NAME;

    if (!functionName) {
      throw new PaymentGatewayClientError(
        'CONFIGURATION_ERROR',
        'PAYMENT_GATEWAY_VERIFY_RECEIPT_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Verifying receipt', {
      functionName,
      platformType: params.platformType,
      subscriptionId: params.subscriptionId,
    });

    return this.invokeLambda<VerifyReceiptResponse>(functionName, params);
  }

  /**
   * サブスクリプションを更新（プラン変更）
   *
   * 既存のサブスクリプションのプランを変更します。プロレート（日割り計算）の有無を指定できます。
   *
   * @param params サブスクリプション更新パラメータ
   * @returns サブスクリプション更新結果
   * @throws PaymentGatewayClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async updateSubscription(
    params: UpdateSubscriptionParams
  ): Promise<UpdateSubscriptionResponse> {
    const functionName =
      process.env.PAYMENT_GATEWAY_UPDATE_SUBSCRIPTION_FUNCTION_NAME;

    if (!functionName) {
      throw new PaymentGatewayClientError(
        'CONFIGURATION_ERROR',
        'PAYMENT_GATEWAY_UPDATE_SUBSCRIPTION_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Updating subscription', {
      functionName,
      platform: params.platform,
      subscriptionId: params.subscriptionId,
      newPlanId: params.newPlanId,
      prorate: params.prorate,
    });

    return this.invokeLambda<UpdateSubscriptionResponse>(functionName, params);
  }

  /**
   * サブスクリプションをキャンセル
   *
   * 既存のサブスクリプションをキャンセルします。期間終了時または即座のキャンセルを選択できます。
   *
   * @param params サブスクリプションキャンセルパラメータ
   * @returns サブスクリプションキャンセル結果
   * @throws PaymentGatewayClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async cancelSubscription(
    params: CancelSubscriptionParams
  ): Promise<CancelSubscriptionResponse> {
    const functionName =
      process.env.PAYMENT_GATEWAY_CANCEL_SUBSCRIPTION_FUNCTION_NAME;

    if (!functionName) {
      throw new PaymentGatewayClientError(
        'CONFIGURATION_ERROR',
        'PAYMENT_GATEWAY_CANCEL_SUBSCRIPTION_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Canceling subscription', {
      functionName,
      platform: params.platform,
      subscriptionId: params.subscriptionId,
      atPeriodEnd: params.atPeriodEnd,
    });

    return this.invokeLambda<CancelSubscriptionResponse>(functionName, params);
  }

  /**
   * Lambda関数を呼び出す共通メソッド
   *
   * 指数バックオフでリトライを行います。一時的エラー（ServiceException、TooManyRequestsException）は
   * リトライ対象とし、恒久的エラー（ResourceNotFoundException等）は即座に例外をスローします。
   *
   * @param functionName Lambda関数名
   * @param payload ペイロード
   * @returns Lambda関数からのレスポンス
   * @throws PaymentGatewayClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  private async invokeLambda<T>(
    functionName: string,
    payload: unknown
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.lambdaClient.send(
          new InvokeCommand({
            FunctionName: functionName,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify(payload),
          })
        );

        // Lambda実行エラーのチェック
        if (response.FunctionError) {
          const errorPayload = response.Payload
            ? JSON.parse(new TextDecoder().decode(response.Payload))
            : {};

          console.error('Lambda function error', {
            functionName,
            functionError: response.FunctionError,
            errorPayload,
            attempt,
          });

          // ビジネスロジックエラーはリトライしない
          throw new PaymentGatewayClientError(
            errorPayload.errorType || 'FUNCTION_ERROR',
            errorPayload.errorMessage ||
              `Lambda function returned error: ${response.FunctionError}`,
            errorPayload
          );
        }

        // ペイロードのパース
        if (!response.Payload) {
          throw new PaymentGatewayClientError(
            'NO_PAYLOAD',
            'No payload returned from Lambda function'
          );
        }

        const result = JSON.parse(new TextDecoder().decode(response.Payload));
        return result as T;
      } catch (error) {
        lastError = error as Error;

        // PaymentGatewayClientErrorはビジネスロジックエラーなのでリトライしない
        if (error instanceof PaymentGatewayClientError) {
          throw error;
        }

        // 一時的エラーかどうかを判定
        const isRetryable = this.isRetryableError(error);

        console.error('Error invoking Lambda function', {
          functionName,
          attempt,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorName: error instanceof Error ? error.name : undefined,
          isRetryable,
        });

        // リトライ不可能なエラーは即座にスロー
        if (!isRetryable) {
          throw new PaymentGatewayClientError(
            'INVOKE_ERROR',
            `Failed to invoke Lambda function: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            {
              functionName,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }

        // 最大リトライ回数に達した場合
        if (attempt >= this.maxRetries) {
          break;
        }

        // 指数バックオフで待機
        const delay = this.baseRetryDelayMs * Math.pow(2, attempt);
        console.log(`Retrying after ${delay}ms...`, { attempt, functionName });
        await this.sleep(delay);
      }
    }

    // 最大リトライ回数に達した場合
    throw new PaymentGatewayClientError(
      'MAX_RETRIES_EXCEEDED',
      `Failed to invoke Lambda function after ${this.maxRetries} retries`,
      {
        functionName,
        lastError: lastError instanceof Error ? lastError.message : 'Unknown error',
      }
    );
  }

  /**
   * エラーがリトライ可能かどうかを判定
   *
   * @param error エラー
   * @returns リトライ可能な場合true
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const retryableErrors = [
      'ServiceException',
      'TooManyRequestsException',
      'ThrottlingException',
      'RequestTimeout',
      'NetworkingError',
      'TimeoutError',
    ];

    return retryableErrors.some((retryableError) =>
      error.name.includes(retryableError)
    );
  }

  /**
   * 指定されたミリ秒だけスリープ
   *
   * @param ms スリープ時間（ミリ秒）
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
