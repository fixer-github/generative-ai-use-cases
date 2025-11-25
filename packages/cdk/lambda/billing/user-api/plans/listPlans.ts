/**
 * プラン一覧取得API
 *
 * ユーザが選択できるプラン（「Freeプラン」「Standardプラン」など）の一覧を、
 * プラットフォーム別に取得します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';
import { CORS_HEADERS } from '../../../utils/apiResponse';
import { getTenantId } from '../../../utils/tenantUtils';
import {
  getPricing,
  PricingInfo,
} from '../../payment-gateway/operations/getPricing';
import { PlatformType } from '../../payment-gateway/repositories/types';

/**
 * プラットフォームマッピング
 */
interface PlatformMapping {
  [key: string]: string;
}

const PLATFORM_MAPPING: PlatformMapping = {
  web: 'stripe',
  ios: 'apple',
  android: 'google',
};

/**
 * プラン情報からpricing情報を取得する
 */
async function extractPricing(
  tenantId: string,
  plan: Plan
): Promise<{
  amount: number;
  currency: string;
  interval: string;
} | null> {
  // Freeプランの場合は0円で固定
  // TODO その場しのぎのフォールバック処理なので、後々適切な実装に移行する
  // 適切な実装→ <TODO： より適切な実装方法について検討する>
  if (plan.internal_name === 'Freeプラン' || !plan.platform_product_id) {
    return {
      amount: 0,
      currency: 'JPY',
      interval: 'month',
    };
  }

  try {
    // payment-gatewayから価格情報を取得
    const pricingResult = await getPricing(
      tenantId,
      plan.platform_product_id,
      plan.platform_type as PlatformType
    );

    // エラーチェック
    if ('error' in pricingResult) {
      console.error('Error fetching pricing:', pricingResult);
      // NOT_IMPLEMENTED エラーの場合は明示的にエラーを投げる
      if (pricingResult.error === 'NOT_IMPLEMENTED') {
        throw new Error(
          `Platform ${plan.platform_type} is not yet implemented`
        );
      }
      // その他のエラーの場合もエラーを投げる
      throw new Error(`Failed to fetch pricing: ${pricingResult.message}`);
    }

    // 正常な価格情報を返す
    const pricingInfo = pricingResult as PricingInfo;
    return {
      amount: pricingInfo.amount,
      currency: pricingInfo.currency,
      interval: pricingInfo.interval,
    };
  } catch (error) {
    console.error('Exception while fetching pricing:', error);
    // エラーを再スロー
    throw error;
  }
}

/**
 * プラン情報からfeatures情報を抽出する
 */
function extractFeatures(permissions: Plan['permissions']): string[] {
  const features: string[] = [];

  // featuresを追加
  if (permissions.features && permissions.features.length > 0) {
    features.push(...permissions.features);
  }

  // limitsから特徴的な機能制限を文字列化して追加
  if (permissions.limits) {
    Object.entries(permissions.limits).forEach(([key, limit]) => {
      if (limit.type === 'unlimited') {
        features.push(`${key}: 無制限`);
      } else if (limit.type === 'daily') {
        features.push(`${key}: 1日${limit.count}回まで`);
      } else if (limit.type === 'monthly') {
        features.push(`${key}: 1ヶ月${limit.count}回まで`);
      }
    });
  }

  return features;
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('List Plans API request received:', {
    queryStringParameters: event.queryStringParameters,
  });

  try {
    // 1. 認証確認（CognitoトークンからテナントIDを取得）
    const tenantId = getTenantId(event);
    console.log('Tenant ID:', tenantId);

    // 2. platformパラメータの取得と検証
    const platformParam = event.queryStringParameters?.platform;

    // パラメータが指定されていない場合
    if (!platformParam) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_PARAMETER',
            message: '必須パラメータが指定されていません',
            details: {
              field: 'platform',
              reason:
                "platformパラメータは必須です。'web', 'ios', 'android' のいずれかを指定してください",
            },
          },
        }),
      };
    }

    // パラメータが不正な場合
    if (!['web', 'ios', 'android'].includes(platformParam)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_PARAMETER',
            message: '無効なパラメータが指定されました',
            details: {
              field: 'platform',
              value: platformParam,
              reason:
                "platformには 'web', 'ios', 'android' のいずれかを指定してください",
            },
          },
        }),
      };
    }

    // 3. プラットフォームマッピング
    const platformType = PLATFORM_MAPPING[platformParam];
    console.log(`Platform mapping: ${platformParam} -> ${platformType}`);

    // 4. プラットフォーム別のプラン取得
    const platformPlans = await invokeDataAccessFunction<Plan[]>(
      event,
      'plan',
      'findActiveByPlatform',
      { platformType }
    );

    console.log(
      `Found ${platformPlans?.length || 0} active plans for platform ${platformType}`
    );

    // 5. デフォルトプラン（internal）も取得して含める
    const defaultPlan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'getDefaultPlan',
      {}
    );

    // プランのマージ（重複を避ける）
    const plans: Plan[] = [...(platformPlans || [])];
    if (defaultPlan && !plans.some((p) => p.plan_id === defaultPlan.plan_id)) {
      plans.push(defaultPlan);
    }

    console.log(
      `Total plans including default: ${plans.length}`
    );

    // 6. レスポンスの構築
    // プランが存在しない場合でも空配列を返す（エラーではない）
    const formattedPlansPromises = (plans || []).map(async (plan) => {
      try {
        const pricing = await extractPricing(tenantId, plan);
        return {
          planId: plan.plan_id,
          planName: plan.internal_name,
          displayName: plan.display_name,
          description: plan.description || '',
          pricing: pricing!,
          features: extractFeatures(plan.permissions),
          platformProductId: plan.platform_product_id || null,
          status: plan.status,
        };
      } catch (error) {
        // 価格取得に失敗した場合
        console.error(
          `Failed to fetch pricing for plan ${plan.plan_id}:`,
          error
        );

        // NOT_IMPLEMENTED エラーの場合は全体をエラーとする
        if (
          error instanceof Error &&
          error.message.includes('not yet implemented')
        ) {
          throw error;
        }

        // その他のエラーの場合も全体をエラーとする
        throw new Error(
          `Failed to fetch pricing for plan ${plan.internal_name}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    });

    const formattedPlans = await Promise.all(formattedPlansPromises);

    // 価格順（安い順）にソート
    formattedPlans.sort((a, b) => {
      const amountA = a.pricing?.amount || 0;
      const amountB = b.pricing?.amount || 0;
      return amountA - amountB;
    });

    const response = {
      platform: platformParam,
      plans: formattedPlans,
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error fetching plans:', error);

    // 認証エラーの場合
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: '認証が必要です',
          },
        }),
      };
    }

    // NOT_IMPLEMENTED エラーの場合
    if (
      error instanceof Error &&
      error.message.includes('not yet implemented')
    ) {
      return {
        statusCode: 501,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'NOT_IMPLEMENTED',
            message: 'このプラットフォームの価格取得機能は未実装です',
            details: error.message,
          },
        }),
      };
    }

    // 価格取得エラーの場合
    if (
      error instanceof Error &&
      error.message.includes('Failed to fetch pricing')
    ) {
      return {
        statusCode: 503,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'PRICING_SERVICE_ERROR',
            message: '価格情報の取得に失敗しました',
            details: error.message,
          },
        }),
      };
    }

    // その他のエラー
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'サーバー内部エラーが発生しました',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      }),
    };
  }
};
