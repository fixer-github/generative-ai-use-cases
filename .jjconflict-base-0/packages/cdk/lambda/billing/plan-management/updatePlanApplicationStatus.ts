/**
 * 内部用: プラン適用状態更新Lambda関数
 *
 * 統括責務のプラン変更フロー、Webhookハンドラーから呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { invokeDataAccessFunctionByTenantId } from '../utils/dataAccessClient';
import { UserPlanApplication } from '../../billing/data-access/repositories/types';

/**
 * 入力パラメータ
 */
export interface UpdatePlanApplicationStatusInput {
  applicationId: string;
  newStatus?: 'active' | 'scheduled_termination' | 'expired';
  validUntil?: string; // ISO 8601（有効期限延長時）
  tenantId: string; // テナントID（RDS接続に必要）
}

/**
 * 出力パラメータ
 */
export interface UpdatePlanApplicationStatusOutput {
  applicationId: string;
  previousStatus: 'active' | 'scheduled_termination' | 'expired';
  newStatus: 'active' | 'scheduled_termination' | 'expired';
  validUntil?: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * エラークラス
 */
export class UpdatePlanApplicationStatusError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'UpdatePlanApplicationStatusError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  input: UpdatePlanApplicationStatusInput
): Promise<UpdatePlanApplicationStatusOutput> => {
  console.log(
    'updatePlanApplicationStatus input:',
    JSON.stringify(input, null, 2)
  );

  try {
    // 入力バリデーション
    if (!input.applicationId) {
      throw new UpdatePlanApplicationStatusError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          applicationId: !!input.applicationId,
        }
      );
    }

    // newStatusとvalidUntilの少なくとも1つが指定されている必要がある
    if (!input.newStatus && !input.validUntil) {
      throw new UpdatePlanApplicationStatusError(
        'NO_UPDATE_FIELDS',
        '更新する項目が指定されていません（newStatusまたはvalidUntilが必要）',
        {
          newStatus: input.newStatus,
          validUntil: input.validUntil,
        }
      );
    }

    // 日付の検証とパース
    let validUntil: Date | undefined;
    if (input.validUntil) {
      try {
        validUntil = new Date(input.validUntil);
        if (isNaN(validUntil.getTime())) {
          throw new Error('Invalid validUntil format');
        }
      } catch (error) {
        throw new UpdatePlanApplicationStatusError(
          'INVALID_DATE',
          '無効な日付形式です',
          {
            validUntil: input.validUntil,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }
    }

    // 1. applicationIdでプラン適用を検索（データアクセス層Lambda関数を呼び出し）
    const application =
      await invokeDataAccessFunctionByTenantId<UserPlanApplication | null>(
        input.tenantId,
        'user-plan-application',
        'findById',
        {
          applicationId: input.applicationId,
        }
      );

    if (!application) {
      throw new UpdatePlanApplicationStatusError(
        'APPLICATION_NOT_FOUND',
        '指定されたプラン適用が見つかりません',
        {
          applicationId: input.applicationId,
        }
      );
    }

    const previousStatus = application.application_status;

    // 2. ステータスまたは有効期限を更新
    const updates: {
      application_status?: 'active' | 'scheduled_termination' | 'expired';
      valid_until?: Date;
    } = {};

    if (input.newStatus) {
      updates.application_status = input.newStatus;
    }

    if (validUntil !== undefined) {
      updates.valid_until = validUntil;
    }

    const updatedApplication =
      await invokeDataAccessFunctionByTenantId<UserPlanApplication | null>(
        input.tenantId,
        'user-plan-application',
        'update',
        {
          applicationId: input.applicationId,
          updates,
        }
      );

    if (!updatedApplication) {
      throw new UpdatePlanApplicationStatusError(
        'UPDATE_FAILED',
        'プラン適用の更新処理に失敗しました',
        {
          applicationId: input.applicationId,
        }
      );
    }

    const updatedAt = new Date();

    console.log('Plan application status updated successfully:', {
      applicationId: updatedApplication.application_id,
      previousStatus,
      newStatus: updatedApplication.application_status,
      validUntil: updatedApplication.valid_until?.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });

    // 3. 結果を返却
    return {
      applicationId: updatedApplication.application_id,
      previousStatus,
      newStatus: updatedApplication.application_status,
      validUntil: updatedApplication.valid_until?.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Error updating plan application status:', error);

    // UpdatePlanApplicationStatusErrorの場合はそのまま再スロー
    if (error instanceof UpdatePlanApplicationStatusError) {
      throw error;
    }

    // その他のエラーは内部エラーとしてラップ
    throw new UpdatePlanApplicationStatusError(
      'INTERNAL_ERROR',
      'プラン適用状態更新処理中に予期しないエラーが発生しました',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }
};
