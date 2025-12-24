/**
 * Subscription Management Internal Function Client
 *
 * サブスクリプション管理責務のInternal関数を呼び出すためのクライアント
 * - サブスクリプションの作成
 * - サブスクリプションステータスの更新
 * - サブスクリプション情報の取得
 * - サブスクリプション期限の延長
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

/**
 * サブスクリプション作成リクエストパラメータ
 */
export interface CreateSubscriptionParams {
  /** テナントID */
  tenantId: string;
  /** ユーザID */
  userId: string;
  /** プランID */
  planId: string;
  /** プラットフォームタイプ（stripe、apple、google） */
  platformType: 'stripe' | 'apple' | 'google';
  /** プラットフォーム側のサブスクリプションID */
  platformSubscriptionId: string;
  /** サブスクリプションステータス */
  subscriptionStatus: 'active' | 'pending_verification';
  /** 現在の期間開始日時（ISO 8601形式） */
  currentPeriodStart: string;
  /** 現在の期間終了日時（ISO 8601形式） */
  currentPeriodEnd: string;
}

/**
 * サブスクリプション作成レスポンス
 */
export interface CreateSubscriptionResponse {
  /** サブスクリプションID */
  subscriptionId: string;
  /** ステータス */
  status: 'active' | 'pending_verification';
}

/**
 * サブスクリプションステータス更新リクエストパラメータ
 */
export interface UpdateSubscriptionStatusParams {
  /** テナントID */
  tenantId: string;
  /** サブスクリプションID */
  subscriptionId: string;
  /** 新しいステータス */
  newStatus: 'active' | 'past_due' | 'canceled' | 'scheduled_cancellation' | 'expired' | 'rolled_back';
}

/**
 * サブスクリプションステータス更新レスポンス
 */
export interface UpdateSubscriptionStatusResponse {
  /** サブスクリプションID */
  subscriptionId: string;
  /** 以前のステータス */
  previousStatus: string;
  /** 新しいステータス */
  newStatus: string;
  /** 更新日時（ISO 8601形式） */
  updatedAt: string;
}

/**
 * サブスクリプション取得リクエストパラメータ
 */
export interface GetSubscriptionParams {
  /** テナントID */
  tenantId: string;
  /** サブスクリプションID */
  subscriptionId: string;
}

/**
 * サブスクリプション期限延長リクエストパラメータ
 */
export interface ExtendSubscriptionPeriodParams {
  /** テナントID */
  tenantId: string;
  /** サブスクリプションID */
  subscriptionId: string;
  /** 新しい有効期限（ISO 8601形式） */
  newExpiresAt: string;
}

/**
 * サブスクリプション期限延長レスポンス
 */
export interface ExtendSubscriptionPeriodResponse {
  /** 成功フラグ */
  success: boolean;
}

/**
 * サブスクリプションプラン更新リクエストパラメータ
 */
export interface UpdateSubscriptionPlanParams {
  /** テナントID */
  tenantId: string;
  /** サブスクリプションID */
  subscriptionId: string;
  /** 新しいプランID */
  newPlanId: string;
}

/**
 * サブスクリプションプラン更新レスポンス
 */
export interface UpdateSubscriptionPlanResponse {
  /** サブスクリプションID */
  subscriptionId: string;
  /** 以前のプランID */
  previousPlanId: string;
  /** 新しいプランID */
  newPlanId: string;
  /** 更新日時（ISO 8601形式） */
  updatedAt: string;
}

/**
 * Lambda呼び出しエラー
 */
export class SubscriptionManagementClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SubscriptionManagementClientError';
  }
}

/**
 * Subscription Management Internal Function Client
 */
export class SubscriptionManagementClient {
  private readonly lambdaClient: LambdaClient;
  private readonly maxRetries = 3;
  private readonly baseRetryDelayMs = 1000;

  constructor(client?: LambdaClient) {
    this.lambdaClient = client || new LambdaClient({});
  }

  /**
   * サブスクリプションを作成
   *
   * 新しいサブスクリプションを作成します。プラットフォーム（Stripe、Apple、Google）から受け取った
   * サブスクリプション情報を元に、システム内でサブスクリプションレコードを作成します。
   *
   * @param params サブスクリプション作成パラメータ
   * @returns サブスクリプション作成結果
   * @throws SubscriptionManagementClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async createSubscription(
    params: CreateSubscriptionParams
  ): Promise<CreateSubscriptionResponse> {
    const functionName =
      process.env.SUBSCRIPTION_MANAGEMENT_CREATE_FUNCTION_NAME;

    if (!functionName) {
      throw new SubscriptionManagementClientError(
        'CONFIGURATION_ERROR',
        'SUBSCRIPTION_MANAGEMENT_CREATE_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Creating subscription', {
      functionName,
      tenantId: params.tenantId,
      userId: params.userId,
      planId: params.planId,
      platformType: params.platformType,
    });

    return this.invokeLambda<CreateSubscriptionResponse>(functionName, params);
  }

  /**
   * サブスクリプションステータスを更新
   *
   * 既存のサブスクリプションのステータスを更新します。Webhookやバッチ処理から呼び出されます。
   *
   * @param params サブスクリプションステータス更新パラメータ
   * @returns ステータス更新結果
   * @throws SubscriptionManagementClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async updateSubscriptionStatus(
    params: UpdateSubscriptionStatusParams
  ): Promise<UpdateSubscriptionStatusResponse> {
    const functionName =
      process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME;

    if (!functionName) {
      throw new SubscriptionManagementClientError(
        'CONFIGURATION_ERROR',
        'SUBSCRIPTION_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Updating subscription status', {
      functionName,
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      newStatus: params.newStatus,
    });

    return this.invokeLambda<UpdateSubscriptionStatusResponse>(
      functionName,
      params
    );
  }

  /**
   * サブスクリプション情報を取得
   *
   * 指定されたサブスクリプションの詳細情報を取得します。
   *
   * @param params サブスクリプション取得パラメータ
   * @returns サブスクリプション情報
   * @throws SubscriptionManagementClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async getSubscription(params: GetSubscriptionParams): Promise<unknown> {
    const functionName = process.env.SUBSCRIPTION_MANAGEMENT_GET_FUNCTION_NAME;

    if (!functionName) {
      throw new SubscriptionManagementClientError(
        'CONFIGURATION_ERROR',
        'SUBSCRIPTION_MANAGEMENT_GET_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Getting subscription', {
      functionName,
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
    });

    return this.invokeLambda<unknown>(functionName, params);
  }

  /**
   * サブスクリプション期限を延長
   *
   * 既存のサブスクリプションの有効期限を延長します。主に更新処理で使用されます。
   *
   * @param params サブスクリプション期限延長パラメータ
   * @returns 期限延長結果
   * @throws SubscriptionManagementClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async extendSubscriptionPeriod(
    params: ExtendSubscriptionPeriodParams
  ): Promise<ExtendSubscriptionPeriodResponse> {
    const functionName =
      process.env.SUBSCRIPTION_MANAGEMENT_EXTEND_PERIOD_FUNCTION_NAME;

    if (!functionName) {
      throw new SubscriptionManagementClientError(
        'CONFIGURATION_ERROR',
        'SUBSCRIPTION_MANAGEMENT_EXTEND_PERIOD_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Extending subscription period', {
      functionName,
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      newExpiresAt: params.newExpiresAt,
    });

    return this.invokeLambda<ExtendSubscriptionPeriodResponse>(
      functionName,
      params
    );
  }

  /**
   * サブスクリプションのプランを更新
   *
   * 既存のサブスクリプションのプランIDを更新します。プラン変更フローから呼び出されます。
   *
   * @param params サブスクリプションプラン更新パラメータ
   * @returns プラン更新結果
   * @throws SubscriptionManagementClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async updateSubscriptionPlan(
    params: UpdateSubscriptionPlanParams
  ): Promise<UpdateSubscriptionPlanResponse> {
    const functionName =
      process.env.SUBSCRIPTION_MANAGEMENT_UPDATE_PLAN_FUNCTION_NAME;

    if (!functionName) {
      throw new SubscriptionManagementClientError(
        'CONFIGURATION_ERROR',
        'SUBSCRIPTION_MANAGEMENT_UPDATE_PLAN_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Updating subscription plan', {
      functionName,
      tenantId: params.tenantId,
      subscriptionId: params.subscriptionId,
      newPlanId: params.newPlanId,
    });

    return this.invokeLambda<UpdateSubscriptionPlanResponse>(
      functionName,
      params
    );
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
   * @throws SubscriptionManagementClientError 呼び出しエラーまたはビジネスロジックエラー
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
          throw new SubscriptionManagementClientError(
            errorPayload.errorType || 'FUNCTION_ERROR',
            errorPayload.errorMessage ||
              `Lambda function returned error: ${response.FunctionError}`,
            errorPayload
          );
        }

        // ペイロードのパース
        if (!response.Payload) {
          throw new SubscriptionManagementClientError(
            'NO_PAYLOAD',
            'No payload returned from Lambda function'
          );
        }

        const result = JSON.parse(new TextDecoder().decode(response.Payload));
        return result as T;
      } catch (error) {
        lastError = error as Error;

        // SubscriptionManagementClientErrorはビジネスロジックエラーなのでリトライしない
        if (error instanceof SubscriptionManagementClientError) {
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
          throw new SubscriptionManagementClientError(
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
    throw new SubscriptionManagementClientError(
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
