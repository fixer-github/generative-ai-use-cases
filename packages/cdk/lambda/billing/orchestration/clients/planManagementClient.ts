/**
 * Plan Management Internal Function Client
 *
 * プラン管理責務のInternal関数を呼び出すためのクライアント
 * - プランのユーザへの適用
 * - プラン適用の終了
 * - プラン適用ステータスの更新
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

/**
 * プラン適用リクエストパラメータ
 */
export interface ApplyPlanToUserParams {
  /** テナントID */
  tenantId: string;
  /** ユーザID */
  userId: string;
  /** プランID */
  planId: string;
  /** 適用元（subscription: サブスクリプション、default: デフォルト、trial: トライアル、campaign: キャンペーン、manual: 手動） */
  applicationSource: 'subscription' | 'default' | 'trial' | 'campaign' | 'manual';
  /** 適用元ID（オプション、サブスクリプションIDなど） */
  applicationSourceId?: string;
  /** 有効開始日時（ISO 8601形式） */
  validFrom: string;
  /** 有効終了日時（ISO 8601形式、オプション） */
  validUntil?: string;
  /** 請求期間開始（Unixタイムスタンプ、ミリ秒単位）- 月次利用回数のリセット基準 */
  periodStart?: number;
  /** 請求期間終了（Unixタイムスタンプ、ミリ秒単位） */
  periodEnd?: number;
}

/**
 * プラン適用レスポンス
 */
export interface ApplyPlanToUserResponse {
  /** 適用ID */
  applicationId: string;
  /** ユーザID */
  userId: string;
  /** プランID */
  planId: string;
  /** 適用ステータス */
  applicationStatus: 'active' | 'scheduled_termination' | 'expired';
  /** 有効開始日時（ISO 8601形式） */
  validFrom: string;
  /** 有効終了日時（ISO 8601形式、オプション） */
  validUntil?: string;
  /** 以前の適用ID配列（置き換えられた適用のID） */
  previousApplicationIds: string[];
}

/**
 * プラン適用終了リクエストパラメータ
 */
export interface TerminatePlanApplicationParams {
  /** テナントID */
  tenantId: string;
  /** ユーザID */
  userId: string;
  /** 適用元ID（サブスクリプションIDなど） */
  applicationSourceId: string;
}

/**
 * プラン適用終了レスポンス
 */
export interface TerminatePlanApplicationResponse {
  /** 適用ID */
  applicationId: string;
  /** 以前のステータス */
  previousStatus: 'active' | 'scheduled_termination';
  /** 新しいステータス */
  newStatus: 'expired';
  /** 終了日時（ISO 8601形式） */
  terminatedAt: string;
  /** 成功フラグ (for backward compatibility) */
  success?: boolean;
}

/**
 * プラン適用ステータス更新リクエストパラメータ
 */
export interface UpdatePlanApplicationStatusParams {
  /** テナントID */
  tenantId: string;
  /** プラン適用ID */
  applicationId: string;
  /** 新しいステータス */
  newStatus: 'active' | 'scheduled_termination' | 'expired';
}

/**
 * プラン適用ステータス更新レスポンス
 */
export interface UpdatePlanApplicationStatusResponse {
  /** 成功フラグ */
  success: boolean;
}

/**
 * Lambda呼び出しエラー
 */
export class PlanManagementClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'PlanManagementClientError';
  }
}

/**
 * Plan Management Internal Function Client
 */
export class PlanManagementClient {
  private readonly lambdaClient: LambdaClient;
  private readonly maxRetries = 3;
  private readonly baseRetryDelayMs = 1000;

  constructor(client?: LambdaClient) {
    this.lambdaClient = client || new LambdaClient({});
  }

  /**
   * プランをユーザに適用
   *
   * 指定されたプランをユーザに適用します。同一ユーザの既存の有効なプラン適用は自動的に終了されます。
   *
   * @param params プラン適用パラメータ
   * @returns プラン適用結果
   * @throws PlanManagementClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async applyPlanToUser(
    params: ApplyPlanToUserParams
  ): Promise<ApplyPlanToUserResponse> {
    const functionName = process.env.PLAN_MANAGEMENT_APPLY_FUNCTION_NAME;

    if (!functionName) {
      throw new PlanManagementClientError(
        'CONFIGURATION_ERROR',
        'PLAN_MANAGEMENT_APPLY_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Applying plan to user', {
      functionName,
      tenantId: params.tenantId,
      userId: params.userId,
      planId: params.planId,
    });

    return this.invokeLambda<ApplyPlanToUserResponse>(functionName, params);
  }

  /**
   * プラン適用を終了
   *
   * 指定されたプラン適用を終了します。immediate=trueの場合は即座に、falseの場合は期間終了時に終了します。
   *
   * @param params プラン適用終了パラメータ
   * @returns 終了結果
   * @throws PlanManagementClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async terminatePlanApplication(
    params: TerminatePlanApplicationParams
  ): Promise<TerminatePlanApplicationResponse> {
    const functionName = process.env.PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME;

    if (!functionName) {
      throw new PlanManagementClientError(
        'CONFIGURATION_ERROR',
        'PLAN_MANAGEMENT_TERMINATE_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Terminating plan application', {
      functionName,
      tenantId: params.tenantId,
      userId: params.userId,
      applicationSourceId: params.applicationSourceId,
    });

    return this.invokeLambda<TerminatePlanApplicationResponse>(
      functionName,
      params
    );
  }

  /**
   * プラン適用ステータスを更新
   *
   * 指定されたプラン適用のステータスを更新します。主にバッチ処理で使用されます。
   *
   * @param params プラン適用ステータス更新パラメータ
   * @returns 更新結果
   * @throws PlanManagementClientError 呼び出しエラーまたはビジネスロジックエラー
   */
  async updatePlanApplicationStatus(
    params: UpdatePlanApplicationStatusParams
  ): Promise<UpdatePlanApplicationStatusResponse> {
    const functionName =
      process.env.PLAN_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME;

    if (!functionName) {
      throw new PlanManagementClientError(
        'CONFIGURATION_ERROR',
        'PLAN_MANAGEMENT_UPDATE_STATUS_FUNCTION_NAME environment variable is not set'
      );
    }

    console.log('Updating plan application status', {
      functionName,
      tenantId: params.tenantId,
      applicationId: params.applicationId,
      newStatus: params.newStatus,
    });

    return this.invokeLambda<UpdatePlanApplicationStatusResponse>(
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
   * @throws PlanManagementClientError 呼び出しエラーまたはビジネスロジックエラー
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
          throw new PlanManagementClientError(
            errorPayload.errorType || 'FUNCTION_ERROR',
            errorPayload.errorMessage ||
              `Lambda function returned error: ${response.FunctionError}`,
            errorPayload
          );
        }

        // ペイロードのパース
        if (!response.Payload) {
          throw new PlanManagementClientError(
            'NO_PAYLOAD',
            'No payload returned from Lambda function'
          );
        }

        const result = JSON.parse(new TextDecoder().decode(response.Payload));
        return result as T;
      } catch (error) {
        lastError = error as Error;

        // PlanManagementClientErrorはビジネスロジックエラーなのでリトライしない
        if (error instanceof PlanManagementClientError) {
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
          throw new PlanManagementClientError(
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
    throw new PlanManagementClientError(
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
