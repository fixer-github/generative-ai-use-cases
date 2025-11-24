/**
 * 内部用: プラン適用Lambda関数
 *
 * 統括責務の購入フロー、プラン変更フロー、Webhookハンドラーから呼び出されます。
 * Lambda-to-Lambda呼び出し専用（API Gateway非公開）
 */

import { randomUUID } from 'crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { invokeDataAccessFunctionByTenantId } from '../utils/dataAccessClient';
import {
  Plan,
  UserPlanApplication,
} from '../../billing/data-access/repositories/types';
import {
  GrantPermissionRequest,
  GrantPermissionResponse,
} from '../../authorization/repositories/types';

const lambdaClient = new LambdaClient({});

/**
 * 入力パラメータ
 */
export interface ApplyPlanToUserInput {
  userId: string;
  planId: string;
  applicationSource:
    | 'subscription'
    | 'default'
    | 'trial'
    | 'campaign'
    | 'manual';
  applicationSourceId?: string;
  validFrom: string; // ISO 8601
  validUntil?: string; // ISO 8601
  tenantId: string; // テナントID（RDS接続に必要）
}

/**
 * 出力パラメータ
 */
export interface ApplyPlanToUserOutput {
  applicationId: string;
  userId: string;
  planId: string;
  applicationStatus: 'active' | 'scheduled_termination' | 'expired';
  validFrom: string; // ISO 8601
  validUntil?: string; // ISO 8601
  previousApplicationIds: string[]; // 終了させた既存のプラン適用ID一覧
  grantId?: string; // 権限付与ID（権限付与が実行された場合）
}

/**
 * エラークラス
 */
export class ApplyPlanToUserError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApplyPlanToUserError';
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  input: ApplyPlanToUserInput
): Promise<ApplyPlanToUserOutput> => {
  console.log('applyPlanToUser input:', JSON.stringify(input, null, 2));

  try {
    // 入力バリデーション
    if (!input.userId || !input.planId || !input.validFrom) {
      throw new ApplyPlanToUserError(
        'INVALID_INPUT',
        '必須パラメータが不足しています',
        {
          userId: !!input.userId,
          planId: !!input.planId,
          validFrom: !!input.validFrom,
        }
      );
    }

    // 日付の検証とパース
    let validFrom: Date;
    let validUntil: Date | undefined;
    try {
      validFrom = new Date(input.validFrom);
      if (isNaN(validFrom.getTime())) {
        throw new Error('Invalid validFrom format');
      }

      if (input.validUntil) {
        validUntil = new Date(input.validUntil);
        if (isNaN(validUntil.getTime())) {
          throw new Error('Invalid validUntil format');
        }

        if (validUntil <= validFrom) {
          throw new Error('validUntil must be after validFrom');
        }
      }
    } catch (error) {
      throw new ApplyPlanToUserError('INVALID_DATE', '無効な日付形式です', {
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // 1. プランの存在確認（データアクセス層Lambda関数を呼び出し）
    const plan = await invokeDataAccessFunctionByTenantId<Plan | null>(
      input.tenantId,
      'plan',
      'findById',
      { id: input.planId }
    );
    if (!plan) {
      throw new ApplyPlanToUserError(
        'PLAN_NOT_FOUND',
        'プランが見つかりません',
        {
          planId: input.planId,
        }
      );
    }

    // プランが購入可能な状態かチェック
    if (plan.status === 'deprecated') {
      throw new ApplyPlanToUserError(
        'PLAN_DEPRECATED',
        'このプランは廃止されており、適用できません',
        {
          planId: input.planId,
          status: plan.status,
        }
      );
    }

    // 2. 既存の有効なプラン適用を終了（データアクセス層Lambda関数を呼び出し）
    const activeApplications = await invokeDataAccessFunctionByTenantId<
      UserPlanApplication[]
    >(input.tenantId, 'user-plan-application', 'findActiveByUserId', {
      userId: input.userId,
    });

    const terminatedApplicationIds: string[] = [];
    for (const activeApplication of activeApplications) {
      // 既存のプラン適用を期限切れに変更
      const expired =
        await invokeDataAccessFunctionByTenantId<UserPlanApplication | null>(
          input.tenantId,
          'user-plan-application',
          'expire',
          { applicationId: activeApplication.application_id }
        );
      if (expired) {
        terminatedApplicationIds.push(expired.application_id);
        console.log('Expired existing application:', {
          applicationId: expired.application_id,
          previousPlanId: expired.plan_id,
        });
      }
    }

    // 3. 新しいプラン適用を作成（データアクセス層Lambda関数を呼び出し）
    const newApplication: Omit<
      UserPlanApplication,
      'application_id' | 'created_at' | 'updated_at'
    > = {
      user_id: input.userId,
      plan_id: input.planId,
      application_source: input.applicationSource,
      application_source_id: input.applicationSourceId,
      application_status: 'active',
      valid_from: validFrom,
      valid_until: validUntil,
    };

    const createdApplication =
      await invokeDataAccessFunctionByTenantId<UserPlanApplication>(
        input.tenantId,
        'user-plan-application',
        'create',
        newApplication
      );

    console.log('Plan application created successfully:', {
      applicationId: createdApplication.application_id,
      userId: createdApplication.user_id,
      planId: createdApplication.plan_id,
      terminatedApplicationIds,
    });

    // 4. プランの権限をユーザーに付与（grantPermission Lambda関数を呼び出し）
    let grantId: string | undefined;

    // grantPermission関数は共通スタックで定義されているため、テナントIDなしの固定名
    const grantPermissionFunctionName = process.env.GRANT_PERMISSION_FUNCTION_NAME;
    if (grantPermissionFunctionName && plan.permissions) {
      try {
        // プランのpermissionsからGrantPermissionRequest.features形式に変換
        const features: GrantPermissionRequest['features'] = [];

        // permissions.featuresをfeatures配列に追加
        if (plan.permissions.features && Array.isArray(plan.permissions.features)) {
          for (const featureId of plan.permissions.features) {
            // limitsに設定があればそれを使用、なければunlimited
            const limit = plan.permissions.limits?.[featureId];
            if (limit) {
              if (limit.type === 'unlimited') {
                features.push({
                  featureId,
                  limitType: 'unlimited',
                });
              } else if (limit.type === 'daily') {
                features.push({
                  featureId,
                  limitType: 'daily',
                  limitCount: limit.count,
                });
              } else if (limit.type === 'monthly') {
                features.push({
                  featureId,
                  limitType: 'monthly',
                  limitCount: limit.count,
                });
              }
            } else {
              // limitsに設定がない場合はunlimitedとして扱う
              features.push({
                featureId,
                limitType: 'unlimited',
              });
            }
          }
        }

        // featuresが空でもEntitlement付与は実行する（OpenFGAへのuser→holder→entitlement登録）
        grantId = randomUUID();

        const grantPermissionRequest: GrantPermissionRequest = {
          tenantId: input.tenantId,
          userId: input.userId,
          grantId,
          planId: input.planId,
          features, // DynamoDBの回数制限カウンター作成に使用
          sourceType: input.applicationSource,
          sourceId: createdApplication.application_id,
        };

        console.log('Invoking grantPermission:', {
          functionName: grantPermissionFunctionName,
          grantId,
          planId: input.planId,
          featuresCount: features.length,
        });

        const grantResponse = await lambdaClient.send(
          new InvokeCommand({
            FunctionName: grantPermissionFunctionName,
            Payload: JSON.stringify(grantPermissionRequest),
          })
        );

        const grantResult = JSON.parse(
          new TextDecoder().decode(grantResponse.Payload)
        ) as GrantPermissionResponse;

        if (!grantResult.success) {
          console.error('grantPermission failed:', grantResult);
          // 権限付与に失敗してもプラン適用は成功とする（ログ記録のみ）
          // 管理者が後から手動で権限付与を行う運用を想定
          grantId = undefined;
        } else {
          console.log('Permission granted successfully:', {
            grantId: grantResult.grantId,
            grantedAt: grantResult.grantedAt,
          });
        }
      } catch (grantError) {
        console.error('Error invoking grantPermission:', grantError);
        // 権限付与に失敗してもプラン適用は成功とする（ログ記録のみ）
        grantId = undefined;
      }
    } else {
      if (!grantPermissionFunctionName) {
        console.log('GRANT_PERMISSION_FUNCTION_NAME not configured, skipping permission grant');
      }
      if (!plan.permissions) {
        console.log('Plan has no permissions defined, skipping permission grant');
      }
    }

    // 5. 結果を返却
    return {
      applicationId: createdApplication.application_id,
      userId: createdApplication.user_id,
      planId: createdApplication.plan_id,
      applicationStatus: createdApplication.application_status,
      validFrom: new Date(createdApplication.valid_from).toISOString(),
      validUntil: createdApplication.valid_until ? new Date(createdApplication.valid_until).toISOString() : undefined,
      previousApplicationIds: terminatedApplicationIds,
      grantId,
    };
  } catch (error) {
    console.error('Error applying plan to user:', error);

    // ApplyPlanToUserErrorの場合はそのまま再スロー
    if (error instanceof ApplyPlanToUserError) {
      throw error;
    }

    // その他のエラーは内部エラーとしてラップ
    throw new ApplyPlanToUserError(
      'INTERNAL_ERROR',
      'プラン適用処理中に予期しないエラーが発生しました',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }
};
