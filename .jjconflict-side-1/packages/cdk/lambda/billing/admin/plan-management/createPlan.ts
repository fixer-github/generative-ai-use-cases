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
} from '../../../utils/adminAuth';
import {
  badRequest400Response,
  conflict409Response,
  created201Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';
import { createOpenFgaClient } from '../../../utils/openFgaClient';

/**
 * Entitlement IDを生成する
 * @param planId プランID
 * @returns Entitlement ID (plan-{planId} 形式)
 */
function generateEntitlementId(planId: string): string {
  return `plan-${planId}`;
}

/**
 * featureIdからリソースタイプとIDを抽出する
 * @param featureId 機能ID (例: "llm:gemini-2.5-flash", "assistant:chat", "prompt-media:image", or "chat")
 * @returns { type: 'llm' | 'assistant' | 'prompt-media' | 'feature', id: string }
 */
function parseFeatureId(featureId: string): {
  type: 'llm' | 'assistant' | 'prompt-media' | 'feature';
  id: string;
} {
  if (featureId.startsWith('llm:')) {
    return { type: 'llm', id: featureId.substring(4) };
  }
  if (featureId.startsWith('assistant:')) {
    return { type: 'assistant', id: featureId.substring(10) };
  }
  if (featureId.startsWith('prompt-media:')) {
    return { type: 'prompt-media', id: featureId.substring(13) };
  }
  return { type: 'feature', id: featureId };
}

/**
 * OpenFGAにプランのEntitlementとリソース関係を登録する
 */
async function registerEntitlementToOpenFga(
  event: APIGatewayProxyEvent,
  planId: string,
  features: string[]
): Promise<void> {
  // Entitlement IDを生成
  const entitlementId = generateEntitlementId(planId);

  // Tuplesを構築
  // entitlement:plan-xxx → via_access → llm:xxx (LLMの場合)
  // entitlement:plan-xxx → via_access → assistant:xxx (Assistantの場合)
  // entitlement:plan-xxx → via_enable → feature:xxx (Featureの場合)
  const tupleKeys = features.map((featureId) => {
    const { type, id } = parseFeatureId(featureId);
    if (type === 'llm') {
      return {
        user: `entitlement:${entitlementId}`,
        relation: 'via_access',
        object: `llm:${id}`,
      };
    } else if (type === 'assistant') {
      return {
        user: `entitlement:${entitlementId}`,
        relation: 'via_access',
        object: `assistant:${id}`,
      };
    } else if (type === 'prompt-media') {
      return {
        user: `entitlement:${entitlementId}`,
        relation: 'via_access',
        object: `prompt-media:${id}`,
      };
    } else {
      return {
        user: `entitlement:${entitlementId}`,
        relation: 'via_enable',
        object: `feature:${id}`,
      };
    }
  });

  if (tupleKeys.length === 0) {
    console.log('No features to register for entitlement');
    return;
  }

  console.log(
    'Registering entitlement tuples to OpenFGA:',
    JSON.stringify(tupleKeys, null, 2)
  );

  // OpenFGAクライアントを作成（APIGatewayのeventから認証情報を使用）
  const openFgaClient = await createOpenFgaClient(event);

  // Tuplesを書き込み
  await openFgaClient.writeTuples(tupleKeys);

  console.log(
    `Entitlement ${entitlementId} registered successfully with ${tupleKeys.length} tuples`
  );
}

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
      return badRequest400Response({
        message: 'リクエストボディが必要です',
        code: 'MISSING_REQUEST_BODY',
      });
    }

    let requestBody: CreatePlanRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return badRequest400Response({
        message: 'リクエストボディのJSON形式が不正です',
        code: 'INVALID_JSON',
      });
    }

    // 必須フィールドのバリデーション
    if (!requestBody.internal_name) {
      return badRequest400Response({
        message: '必須フィールドが不足しています',
        code: 'MISSING_REQUIRED_FIELD',
        details: {
          field: 'internal_name',
          reason: 'internal_nameは必須です',
        },
      });
    }

    if (!requestBody.display_name) {
      return badRequest400Response({
        message: '必須フィールドが不足しています',
        code: 'MISSING_REQUIRED_FIELD',
        details: {
          field: 'display_name',
          reason: 'display_nameは必須です',
        },
      });
    }

    if (!requestBody.platform_type) {
      return badRequest400Response({
        message: '必須フィールドが不足しています',
        code: 'MISSING_REQUIRED_FIELD',
        details: {
          field: 'platform_type',
          reason: 'platform_typeは必須です',
        },
      });
    }

    if (!requestBody.permissions) {
      return badRequest400Response({
        message: '必須フィールドが不足しています',
        code: 'MISSING_REQUIRED_FIELD',
        details: {
          field: 'permissions',
          reason: 'permissionsは必須です',
        },
      });
    }

    // platform_typeのバリデーション
    if (
      !['stripe', 'apple', 'google', 'internal'].includes(
        requestBody.platform_type
      )
    ) {
      return badRequest400Response({
        message: 'フィールドの値が不正です',
        code: 'INVALID_FIELD_VALUE',
        details: {
          field: 'platform_type',
          reason:
            "platform_typeには 'stripe', 'apple', 'google', 'internal' のいずれかを指定してください",
        },
      });
    }

    // platform_product_idのバリデーション
    if (
      requestBody.platform_type !== 'internal' &&
      !requestBody.platform_product_id
    ) {
      return badRequest400Response({
        message: '必須フィールドが不足しています',
        code: 'MISSING_REQUIRED_FIELD',
        details: {
          field: 'platform_product_id',
          reason:
            'platform_typeがinternal以外の場合、platform_product_idは必須です',
        },
      });
    }

    // platform_product_idの形式チェック
    if (requestBody.platform_product_id) {
      if (
        requestBody.platform_type === 'stripe' &&
        !requestBody.platform_product_id.startsWith('price_')
      ) {
        return badRequest400Response({
          message: 'プラットフォーム商品IDの形式が正しくありません',
          code: 'INVALID_PLATFORM_PRODUCT_ID',
          details: {
            field: 'platform_product_id',
            reason: "Stripeの場合は 'price_' で始まるIDを入力してください",
          },
        });
      }

      // TODO: Apple、Googleの形式チェックも追加
    }

    // permissionsの構造チェック
    if (
      !requestBody.permissions.features ||
      !Array.isArray(requestBody.permissions.features)
    ) {
      return badRequest400Response({
        message: 'permissions フィールドのJSON形式が不正です',
        code: 'INVALID_JSON_FORMAT',
        details: {
          field: 'permissions',
          reason: 'features フィールドが必須です',
        },
      });
    }

    if (
      !requestBody.permissions.limits ||
      typeof requestBody.permissions.limits !== 'object'
    ) {
      return badRequest400Response({
        message: 'permissions フィールドのJSON形式が不正です',
        code: 'INVALID_JSON_FORMAT',
        details: {
          field: 'permissions',
          reason: 'limits フィールドが必須です',
        },
      });
    }

    // limitsの各エントリの構造チェック
    for (const [key, limit] of Object.entries(requestBody.permissions.limits)) {
      if (
        !limit.type ||
        !['unlimited', 'daily', 'monthly'].includes(limit.type)
      ) {
        return badRequest400Response({
          message: 'permissions フィールドのJSON形式が不正です',
          code: 'INVALID_JSON_FORMAT',
          details: {
            field: `permissions.limits.${key}`,
            reason:
              "typeには 'unlimited', 'daily', 'monthly' のいずれかを指定してください",
          },
        });
      }

      if (limit.type !== 'unlimited') {
        const limitWithCount = limit as {
          type: 'daily' | 'monthly';
          count: number;
        };
        if (
          typeof limitWithCount.count !== 'number' ||
          limitWithCount.count <= 0
        ) {
          return badRequest400Response({
            message: 'permissions フィールドのJSON形式が不正です',
            code: 'INVALID_JSON_FORMAT',
            details: {
              field: `permissions.limits.${key}`,
              reason:
                'typeがunlimited以外の場合、countは正の整数である必要があります',
            },
          });
        }
      }
    }

    // 内部名称の重複チェック（データアクセス層Lambda関数を呼び出し）
    const existingPlan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findByInternalName',
      { internalName: requestBody.internal_name }
    );
    if (existingPlan) {
      return conflict409Response({
        message: 'この内部名称は既に使われています',
        code: 'DUPLICATE_INTERNAL_NAME',
        details: {
          field: 'internal_name',
          value: requestBody.internal_name,
        },
      });
    }

    // プランを作成（データアクセス層Lambda関数を呼び出し）
    const newPlan = await invokeDataAccessFunction<Plan>(
      event,
      'plan',
      'create',
      {
        internal_name: requestBody.internal_name,
        display_name: requestBody.display_name,
        description: requestBody.description,
        platform_type: requestBody.platform_type,
        platform_product_id: requestBody.platform_product_id,
        permissions: requestBody.permissions,
        status: 'active', // 新規作成時は自動的にactive
      }
    );

    console.log(
      `Plan created: ${newPlan.plan_id} by user ${adminResult.username}`
    );

    // OpenFGAにEntitlementとリソース関係を登録
    try {
      await registerEntitlementToOpenFga(
        event,
        newPlan.plan_id,
        requestBody.permissions.features
      );
      console.log(
        `Entitlement registered to OpenFGA for plan: ${newPlan.plan_id}`
      );
    } catch (openFgaError) {
      // OpenFGAへの登録に失敗してもプラン作成は成功とする
      // 管理者が後から手動で権限付与を行う運用を想定
      console.error(
        `Failed to register entitlement to OpenFGA for plan ${newPlan.plan_id}:`,
        openFgaError
      );
      // 警告をレスポンスに含める（エラーにはしない）
      console.warn(
        'Plan created but entitlement registration failed. Manual registration may be required.'
      );
    }

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
      created_at: new Date(newPlan.created_at).toISOString(),
      updated_at: new Date(newPlan.updated_at).toISOString(),
    };

    return created201Response(response);
  } catch (error) {
    console.error('Error creating plan:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
