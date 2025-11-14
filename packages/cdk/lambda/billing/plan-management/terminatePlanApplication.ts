/**
 * 内部用: プラン適用終了Lambda関数
 *
 * 統括責務の解約フロー、Webhookハンドラーから呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { UserPlanApplicationRepository } from '../../repositories';
import { getRdsConnection } from '../../utils/rdsConnection';

/**
 * 入力パラメータ
 */
export interface TerminatePlanApplicationInput {
  userId: string;
  applicationSourceId: string; // サブスクリプションIDなど
  tenantId: string; // テナントID（RDS接続に必要）
}

/**
 * 出力パラメータ
 */
export interface TerminatePlanApplicationOutput {
  applicationId: string;
  previousStatus: 'active' | 'scheduled_termination';
  newStatus: 'expired';
  terminatedAt: string; // ISO 8601
}

/**
 * エラークラス
 */
export class TerminatePlanApplicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'TerminatePlanApplicationError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  input: TerminatePlanApplicationInput
): Promise<TerminatePlanApplicationOutput> => {
  console.log(
    'terminatePlanApplication input:',
    JSON.stringify(input, null, 2)
  );

  try {
    // 入力バリデーション
    if (!input.userId || !input.applicationSourceId) {
      throw new TerminatePlanApplicationError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          userId: !!input.userId,
          applicationSourceId: !!input.applicationSourceId,
        }
      );
    }

    // RDS接続設定の取得（テナント専用のRDS接続）
    const rdsConnection = await getRdsConnection({
      requestContext: {
        authorizer: {
          claims: {
            'custom:tenant_id': input.tenantId,
          },
        },
      },
    } as any);

    const userPlanApplicationRepository = new UserPlanApplicationRepository(
      rdsConnection
    );

    // 1. applicationSourceIdでプラン適用を検索
    const applications = await userPlanApplicationRepository.findByApplicationSourceId(
      input.applicationSourceId
    );

    if (applications.length === 0) {
      throw new TerminatePlanApplicationError(
        'APPLICATION_NOT_FOUND',
        '指定されたプラン適用が見つかりません',
        {
          userId: input.userId,
          applicationSourceId: input.applicationSourceId,
        }
      );
    }

    // ユーザーIDが一致するアクティブまたはscheduled_terminationのプラン適用を検索
    const targetApplication = applications.find(
      (app) =>
        app.user_id === input.userId &&
        (app.application_status === 'active' ||
          app.application_status === 'scheduled_termination')
    );

    if (!targetApplication) {
      throw new TerminatePlanApplicationError(
        'NO_ACTIVE_APPLICATION',
        'このユーザーにアクティブなプラン適用が見つかりません',
        {
          userId: input.userId,
          applicationSourceId: input.applicationSourceId,
          foundApplications: applications.map((app) => ({
            applicationId: app.application_id,
            userId: app.user_id,
            status: app.application_status,
          })),
        }
      );
    }

    const previousStatus = targetApplication.application_status;

    // 2. application_statusをexpiredに変更
    const expiredApplication = await userPlanApplicationRepository.expire(
      targetApplication.application_id
    );

    if (!expiredApplication) {
      throw new TerminatePlanApplicationError(
        'TERMINATION_FAILED',
        'プラン適用の終了処理に失敗しました',
        {
          applicationId: targetApplication.application_id,
        }
      );
    }

    const terminatedAt = new Date();

    console.log('Plan application terminated successfully:', {
      applicationId: expiredApplication.application_id,
      userId: expiredApplication.user_id,
      previousStatus,
      newStatus: expiredApplication.application_status,
      terminatedAt: terminatedAt.toISOString(),
    });

    // 3. 結果を返却
    return {
      applicationId: expiredApplication.application_id,
      previousStatus: previousStatus as 'active' | 'scheduled_termination',
      newStatus: 'expired',
      terminatedAt: terminatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Error terminating plan application:', error);

    // TerminatePlanApplicationErrorの場合はそのまま再スロー
    if (error instanceof TerminatePlanApplicationError) {
      throw error;
    }

    // その他のエラーは内部エラーとしてラップ
    throw new TerminatePlanApplicationError(
      'INTERNAL_ERROR',
      'プラン適用終了処理中に予期しないエラーが発生しました',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }
};
