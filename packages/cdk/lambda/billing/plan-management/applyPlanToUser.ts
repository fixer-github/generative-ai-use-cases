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
  RevokePermissionRequest,
  RevokePermissionResponse,
} from '../../authorization/repositories/types';

const lambdaClient = new LambdaClient({});

/**
 * 権限付与失敗時にプラン適用をロールバック（期限切れに変更）
 */
async function rollbackPlanApplication(
  tenantId: string,
  applicationId: string
): Promise<void> {
  try {
    await invokeDataAccessFunctionByTenantId<UserPlanApplication | null>(
      tenantId,
      'user-plan-application',
      'expire',
      { applicationId }
    );
    console.log('Rolled back plan application:', { applicationId });
  } catch (rollbackError) {
    // ロールバック自体が失敗した場合はログのみ（二重エラーを避ける）
    console.error('Failed to rollback plan application:', {
      applicationId,
      error: rollbackError instanceof Error ? rollbackError.message : 'Unknown error',
    });
  }
}

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
  periodStart?: number; // 請求期間開始時刻（Unixタイムスタンプ、秒単位）
  periodEnd?: number; // 請求期間終了時刻（Unixタイムスタンプ、秒単位）
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
  periodUpdatedOnly?: boolean; // 同一プランで期間のみ更新された場合にtrue
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

    // applicationSourceに応じた期間情報のバリデーション
    // subscription: periodStart/periodEndが必須
    // default/trial/campaign/manual: periodStart/periodEndは不要（指定されてもエラーにはしないが警告）
    if (input.applicationSource === 'subscription') {
      if (input.periodStart === undefined || input.periodEnd === undefined) {
        throw new ApplyPlanToUserError(
          'INVALID_INPUT',
          'サブスクリプションプランの適用にはperiodStartとperiodEndが必須です',
          {
            applicationSource: input.applicationSource,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          }
        );
      }
    } else {
      // Internal系（default/trial/campaign/manual）でperiodStart/periodEndが指定されている場合は警告
      if (input.periodStart !== undefined || input.periodEnd !== undefined) {
        console.warn('Non-subscription application source should not have periodStart/periodEnd', {
          applicationSource: input.applicationSource,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        });
      }
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

    // 2. 既存の有効なプラン適用を取得
    const activeApplications = await invokeDataAccessFunctionByTenantId<
      UserPlanApplication[]
    >(input.tenantId, 'user-plan-application', 'findActiveByUserId', {
      userId: input.userId,
    });

    // 同一プラン・同一ソースのアプリケーションがあるかチェック
    // applicationSourceIdが指定されている場合のみチェック
    if (input.applicationSourceId) {
      const sameSourceApplication = activeApplications.find(
        (app) =>
          app.application_source_id === input.applicationSourceId &&
          app.plan_id === input.planId
      );

      // 同一プラン・同一ソースの場合は期間更新のみ
      if (sameSourceApplication && input.periodStart !== undefined && input.periodEnd !== undefined) {
        console.log('Same plan and source detected, updating period only', {
          applicationId: sameSourceApplication.application_id,
          planId: input.planId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        });

        // PermissionGrantの期間を更新（updatePermissionPeriod Lambda関数を呼び出し）
        const updatePermissionPeriodFunctionName = process.env.UPDATE_PERMISSION_PERIOD_FUNCTION_NAME;
        if (updatePermissionPeriodFunctionName) {
          try {
            const updatePeriodRequest = {
              tenantId: input.tenantId,
              sourceId: sameSourceApplication.application_id,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
            };

            console.log('Invoking updatePermissionPeriod:', {
              functionName: updatePermissionPeriodFunctionName,
              sourceId: sameSourceApplication.application_id,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
            });

            const updateResponse = await lambdaClient.send(
              new InvokeCommand({
                FunctionName: updatePermissionPeriodFunctionName,
                Payload: JSON.stringify(updatePeriodRequest),
              })
            );

            const updateResult = JSON.parse(
              new TextDecoder().decode(updateResponse.Payload)
            );

            if (!updateResult.success) {
              console.error('updatePermissionPeriod failed:', updateResult);
              // 期間更新に失敗した場合でも処理は続行（ログ記録のみ）
            } else {
              console.log('Permission period updated successfully:', {
                grantId: updateResult.grantId,
                periodStart: input.periodStart,
                periodEnd: input.periodEnd,
              });
            }
          } catch (updateError) {
            console.error('Error invoking updatePermissionPeriod:', updateError);
            // 期間更新に失敗した場合でも処理は続行（ログ記録のみ）
          }
        } else {
          console.log('UPDATE_PERMISSION_PERIOD_FUNCTION_NAME not configured, skipping period update');
        }

        // 期間更新のみで完了
        return {
          applicationId: sameSourceApplication.application_id,
          userId: sameSourceApplication.user_id,
          planId: sameSourceApplication.plan_id,
          applicationStatus: sameSourceApplication.application_status,
          validFrom: new Date(sameSourceApplication.valid_from).toISOString(),
          validUntil: sameSourceApplication.valid_until
            ? new Date(sameSourceApplication.valid_until).toISOString()
            : undefined,
          previousApplicationIds: [],
          periodUpdatedOnly: true,
        };
      }
    }

    // 3. 既存の有効なプラン適用を終了（データアクセス層Lambda関数を呼び出し）
    const terminatedApplicationIds: string[] = [];
    const revokePermissionFunctionName = process.env.REVOKE_PERMISSION_FUNCTION_NAME;

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

        // 既存プランの権限を剥奪（revokePermission Lambda関数を呼び出し）
        if (revokePermissionFunctionName) {
          try {
            const revokePermissionRequest: RevokePermissionRequest = {
              tenantId: input.tenantId,
              sourceId: expired.application_id, // application_idでPermissionGrantを検索
              planId: expired.plan_id,
            };

            console.log('Invoking revokePermission:', {
              functionName: revokePermissionFunctionName,
              sourceId: expired.application_id,
              planId: expired.plan_id,
            });

            const revokeResponse = await lambdaClient.send(
              new InvokeCommand({
                FunctionName: revokePermissionFunctionName,
                Payload: JSON.stringify(revokePermissionRequest),
              })
            );

            const revokeResult = JSON.parse(
              new TextDecoder().decode(revokeResponse.Payload)
            ) as RevokePermissionResponse;

            if (!revokeResult.success) {
              console.error('revokePermission failed:', revokeResult);
              // 権限剥奪に失敗してもプラン適用は継続（ログ記録のみ）
            } else {
              console.log('Permission revoked successfully:', {
                grantId: revokeResult.grantId,
                revokedAt: revokeResult.revokedAt,
              });
            }
          } catch (revokeError) {
            console.error('Error invoking revokePermission:', revokeError);
            // 権限剥奪に失敗してもプラン適用は継続（ログ記録のみ）
          }
        } else {
          console.log('REVOKE_PERMISSION_FUNCTION_NAME not configured, skipping permission revoke');
        }
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
              } else if (limit.type === 'billing_period') {
                features.push({
                  featureId,
                  limitType: 'billing_period',
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
          ...(input.periodStart !== undefined && { periodStart: input.periodStart }),
          ...(input.periodEnd !== undefined && { periodEnd: input.periodEnd }),
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
          // 権限付与に失敗した場合、作成したプラン適用をロールバック
          await rollbackPlanApplication(input.tenantId, createdApplication.application_id);
          throw new ApplyPlanToUserError(
            'PERMISSION_GRANT_FAILED',
            '権限付与に失敗しました。プラン適用をロールバックしました。',
            {
              grantId,
              planId: input.planId,
              applicationId: createdApplication.application_id,
              grantResult,
            }
          );
        }
        console.log('Permission granted successfully:', {
          grantId: grantResult.grantId,
          grantedAt: grantResult.grantedAt,
        });
      } catch (grantError) {
        // ApplyPlanToUserErrorは再スロー
        if (grantError instanceof ApplyPlanToUserError) {
          throw grantError;
        }
        console.error('Error invoking grantPermission:', grantError);
        // 権限付与に失敗した場合、作成したプラン適用をロールバック
        await rollbackPlanApplication(input.tenantId, createdApplication.application_id);
        throw new ApplyPlanToUserError(
          'PERMISSION_GRANT_ERROR',
          '権限付与処理中にエラーが発生しました。プラン適用をロールバックしました。',
          {
            grantId,
            planId: input.planId,
            applicationId: createdApplication.application_id,
            error: grantError instanceof Error ? grantError.message : 'Unknown error',
          }
        );
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
