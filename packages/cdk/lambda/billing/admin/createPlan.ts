/**
 * プラン作成API
 * POST /admin/billing/plans
 *
 * 新しいプランを作成します。作成されたプランは自動的にactiveステータスになります。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
  CORS_HEADERS,
} from '../../utils/adminAuth';
import { PlanRepository, Plan } from '../../repositories';
import { getRdsConfig } from '../../utils/rdsConfig';

interface CreatePlanRequest {
  internal_name: string;
  display_name: string;
  description?: string;
  platform_type: 'stripe' | 'apple' | 'google' | 'internal';
  platform_product_id?: string;
  permissions: {
    features: string[];
    limits: Record<
      string,
      | { type: 'unlimited' }
      | { type: 'daily'; count: number }
      | { type: 'monthly'; count: number }
    >;
  };
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // 管理者権限の検証
    const adminResult = await verifyAdminAccess(event);
    if (!isAdminContext(adminResult)) {
      return adminResult;
    }

    // リクエストボディのパース
    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUEST_BODY',
            message: 'リクエストボディが必要です',
          },
        }),
      };
    }

    let requestBody: CreatePlanRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: 'リクエストボディのJSON形式が不正です',
          },
        }),
      };
    }

    // 必須フィールドのバリデーション
    if (!requestBody.internal_name) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUIRED_FIELD',
            message: '必須フィールドが不足しています',
            details: {
              field: 'internal_name',
              reason: 'internal_nameは必須です',
            },
          },
        }),
      };
    }

    if (!requestBody.display_name) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUIRED_FIELD',
            message: '必須フィールドが不足しています',
            details: {
              field: 'display_name',
              reason: 'display_nameは必須です',
            },
          },
        }),
      };
    }

    if (!requestBody.platform_type) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUIRED_FIELD',
            message: '必須フィールドが不足しています',
            details: {
              field: 'platform_type',
              reason: 'platform_typeは必須です',
            },
          },
        }),
      };
    }

    if (!requestBody.permissions) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUIRED_FIELD',
            message: '必須フィールドが不足しています',
            details: {
              field: 'permissions',
              reason: 'permissionsは必須です',
            },
          },
        }),
      };
    }

    // platform_typeのバリデーション
    if (
      !['stripe', 'apple', 'google', 'internal'].includes(
        requestBody.platform_type
      )
    ) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_FIELD_VALUE',
            message: 'フィールドの値が不正です',
            details: {
              field: 'platform_type',
              reason:
                "platform_typeには 'stripe', 'apple', 'google', 'internal' のいずれかを指定してください",
            },
          },
        }),
      };
    }

    // platform_product_idのバリデーション
    if (
      requestBody.platform_type !== 'internal' &&
      !requestBody.platform_product_id
    ) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_REQUIRED_FIELD',
            message: '必須フィールドが不足しています',
            details: {
              field: 'platform_product_id',
              reason: 'platform_typeがinternal以外の場合、platform_product_idは必須です',
            },
          },
        }),
      };
    }

    // platform_product_idの形式チェック
    if (requestBody.platform_product_id) {
      if (
        requestBody.platform_type === 'stripe' &&
        !requestBody.platform_product_id.startsWith('price_')
      ) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: {
              code: 'INVALID_PLATFORM_PRODUCT_ID',
              message: 'プラットフォーム商品IDの形式が正しくありません',
              details: {
                field: 'platform_product_id',
                reason: "Stripeの場合は 'price_' で始まるIDを入力してください",
              },
            },
          }),
        };
      }

      // TODO: Apple、Googleの形式チェックも追加
    }

    // permissionsの構造チェック
    if (!requestBody.permissions.features || !Array.isArray(requestBody.permissions.features)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON_FORMAT',
            message: 'permissions フィールドのJSON形式が不正です',
            details: {
              field: 'permissions',
              reason: 'features フィールドが必須です',
            },
          },
        }),
      };
    }

    if (!requestBody.permissions.limits || typeof requestBody.permissions.limits !== 'object') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON_FORMAT',
            message: 'permissions フィールドのJSON形式が不正です',
            details: {
              field: 'permissions',
              reason: 'limits フィールドが必須です',
            },
          },
        }),
      };
    }

    // limitsの各エントリの構造チェック
    for (const [key, limit] of Object.entries(requestBody.permissions.limits)) {
      if (!limit.type || !['unlimited', 'daily', 'monthly'].includes(limit.type)) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: {
              code: 'INVALID_JSON_FORMAT',
              message: 'permissions フィールドのJSON形式が不正です',
              details: {
                field: `permissions.limits.${key}`,
                reason: "typeには 'unlimited', 'daily', 'monthly' のいずれかを指定してください",
              },
            },
          }),
        };
      }

      if (limit.type !== 'unlimited') {
        const limitWithCount = limit as { type: 'daily' | 'monthly'; count: number };
        if (typeof limitWithCount.count !== 'number' || limitWithCount.count <= 0) {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({
              error: {
                code: 'INVALID_JSON_FORMAT',
                message: 'permissions フィールドのJSON形式が不正です',
                details: {
                  field: `permissions.limits.${key}`,
                  reason: 'typeがunlimited以外の場合、countは正の整数である必要があります',
                },
              },
            }),
          };
        }
      }
    }

    // RDS接続設定の取得
    const rdsConfig = await getRdsConfig(adminResult.tenantId);
    const planRepository = new PlanRepository(rdsConfig);

    // 内部名称の重複チェック
    const existingPlan = await planRepository.findByInternalName(
      requestBody.internal_name
    );
    if (existingPlan) {
      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'DUPLICATE_INTERNAL_NAME',
            message: 'この内部名称は既に使われています',
            details: {
              field: 'internal_name',
              value: requestBody.internal_name,
            },
          },
        }),
      };
    }

    // プランを作成
    const newPlan = await planRepository.create({
      internal_name: requestBody.internal_name,
      display_name: requestBody.display_name,
      description: requestBody.description,
      platform_type: requestBody.platform_type,
      platform_product_id: requestBody.platform_product_id,
      permissions: requestBody.permissions,
      status: 'active', // 新規作成時は自動的にactive
    });

    // TODO: 監査ログの記録
    console.log(
      `Plan created: ${newPlan.plan_id} by user ${adminResult.username}`
    );

    // レスポンスの構築
    const response = {
      plan_id: newPlan.plan_id,
      internal_name: newPlan.internal_name,
      display_name: newPlan.display_name,
      description: newPlan.description || null,
      platform_type: newPlan.platform_type,
      platform_product_id: newPlan.platform_product_id || null,
      permissions: newPlan.permissions,
      status: newPlan.status,
      created_at: newPlan.created_at.toISOString(),
      updated_at: newPlan.updated_at.toISOString(),
    };

    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error creating plan:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'サーバー内部エラーが発生しました',
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      }),
    };
  }
};
