/**
 * Access Checker with Quota
 * 権限チェック + 回数制限チェックを統合したモジュール
 *
 * OpenFGAでの権限チェックとDynamoDBでの回数制限チェックを行い、
 * アクセス可否と使用状況を返却します
 */

import { verifyToken } from './auth';
import { createOpenFgaClientFromToken } from './openFgaClient';
import { createTenantDynamoDBClientFromToken } from './tenantDynamoDBClient';
import { UsageCountRepository } from '../authorization/repositories/usageCountRepository';

/**
 * アクセスチェック結果の型定義
 */
export interface AccessCheckResult {
  allowed: boolean;
  reason?: 'no_permission' | 'quota_exceeded' | 'invalid_token';
  usage?: {
    daily?: {
      current: number;
      limit: number;
      remaining: number;
    };
    monthly?: {
      current: number;
      limit: number;
      remaining: number;
    };
  };
  /** 回数制限のタイプ（incrementUsageで使用） */
  limitType?: 'unlimited' | 'daily' | 'monthly';
  /** 検証済みのユーザー情報（後続処理で使用） */
  userContext?: {
    tenantId: string;
    userId: string;
  };
}

/**
 * リソースタイプの定義
 * - llm: LLMモデル（例: gemini-2.5-flash）
 * - 将来的に他のリソースタイプを追加可能
 */
export type ResourceType = 'llm';

/**
 * テーブル名を生成するヘルパー関数
 */
function getTableName(
  baseTableName: string,
  tenantId: string,
  environment: string
): string {
  const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${baseTableName}-${environment}-tenant-${sanitizedTenantId}`;
}

/**
 * featureIdを生成する
 * @param resourceType リソースの種別（例: 'llm'）
 * @param resourceId リソースのID（例: 'gemini-2.5-flash'）
 * @returns featureId（例: 'llm:gemini-2.5-flash'）
 */
export function buildFeatureId(
  resourceType: ResourceType,
  resourceId: string
): string {
  return `${resourceType}:${resourceId}`;
}

/**
 * 権限チェック + 回数制限チェックを行う
 *
 * @param idToken - Cognito ID Token
 * @param resourceType - リソースの種別（例: 'llm'）
 * @param resourceId - リソースのID（例: 'gemini-2.5-flash'）
 * @returns AccessCheckResult - アクセス可否と使用状況
 */
export async function checkAccessWithQuota(
  idToken: string,
  resourceType: ResourceType,
  resourceId: string
): Promise<AccessCheckResult> {
  // 1. トークン検証とユーザー情報の取得
  const payload = await verifyToken(idToken);
  if (!payload) {
    return {
      allowed: false,
      reason: 'invalid_token',
    };
  }

  const tenantId = payload['custom:tenant_id'];
  const userId = payload['cognito:username'];

  if (!tenantId || !userId) {
    console.error('Missing tenantId or userId in token claims');
    return {
      allowed: false,
      reason: 'invalid_token',
    };
  }

  const featureId = buildFeatureId(resourceType, resourceId);

  console.log(
    `[AccessCheck] Starting access check - tenantId: ${tenantId}, userId: ${userId}, featureId: ${featureId}`
  );

  // 2. OpenFGAで権限チェック
  try {
    console.log(
      `[AccessCheck] Checking OpenFGA permission - userId: ${userId}, resourceType: ${resourceType}, resourceId: ${resourceId}`
    );
    const openFgaClient = await createOpenFgaClientFromToken(idToken);
    const hasPermission = await openFgaClient.check(
      userId,
      'accessor',
      resourceType,
      resourceId
    );

    console.log(
      `[AccessCheck] OpenFGA check result - hasPermission: ${hasPermission}`
    );

    if (!hasPermission) {
      console.log(
        `[AccessCheck] Permission denied - User ${userId} does not have permission to access ${featureId}`
      );
      return {
        allowed: false,
        reason: 'no_permission',
        userContext: { tenantId, userId },
      };
    }
  } catch (error) {
    console.error('[AccessCheck] OpenFGA check failed:', error);
    return {
      allowed: false,
      reason: 'no_permission',
      userContext: { tenantId, userId },
    };
  }

  // 3. DynamoDBで回数制限チェック
  try {
    const dynamoDBClient = await createTenantDynamoDBClientFromToken(idToken);

    const usageCounterTableName = getTableName(
      'AuthUsageCounter',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    const usageCountRepository = new UsageCountRepository(
      dynamoDBClient,
      usageCounterTableName
    );

    console.log(
      `[AccessCheck] Fetching usage counters - tableName: ${usageCounterTableName}, userId: ${userId}, featureId: ${featureId}`
    );

    // 日次制限と月次制限の両方を取得
    const [dailyCounter, monthlyCounter] = await Promise.all([
      usageCountRepository.get(userId, `${featureId}#daily`),
      usageCountRepository.get(userId, `${featureId}#monthly`),
    ]);

    console.log(
      `[AccessCheck] Counter fetch results - dailyCounter: ${dailyCounter ? JSON.stringify(dailyCounter) : 'null'}, monthlyCounter: ${monthlyCounter ? JSON.stringify(monthlyCounter) : 'null'}`
    );

    const usage: AccessCheckResult['usage'] = {};
    let limitType: AccessCheckResult['limitType'] = 'unlimited';

    // 日次制限のチェック
    if (dailyCounter) {
      console.log(
        `[AccessCheck] Daily limit found - currentCount: ${dailyCounter.currentCount}, limitCount: ${dailyCounter.limitCount}`
      );
      limitType = 'daily';
      const remaining = dailyCounter.limitCount - dailyCounter.currentCount;
      usage.daily = {
        current: dailyCounter.currentCount,
        limit: dailyCounter.limitCount,
        remaining: Math.max(0, remaining),
      };

      if (dailyCounter.currentCount >= dailyCounter.limitCount) {
        console.log(
          `[AccessCheck] Daily quota exceeded - User ${userId}, featureId: ${featureId}, current: ${dailyCounter.currentCount}, limit: ${dailyCounter.limitCount}`
        );
        return {
          allowed: false,
          reason: 'quota_exceeded',
          usage,
          limitType,
          userContext: { tenantId, userId },
        };
      }
      console.log(
        `[AccessCheck] Daily quota check passed - remaining: ${remaining}`
      );
    } else {
      console.log(`[AccessCheck] No daily limit configured for ${featureId}`);
    }

    // 月次制限のチェック
    if (monthlyCounter) {
      console.log(
        `[AccessCheck] Monthly limit found - currentCount: ${monthlyCounter.currentCount}, limitCount: ${monthlyCounter.limitCount}`
      );
      // 日次制限がなければ月次制限を優先
      if (!dailyCounter) {
        limitType = 'monthly';
      }
      const remaining = monthlyCounter.limitCount - monthlyCounter.currentCount;
      usage.monthly = {
        current: monthlyCounter.currentCount,
        limit: monthlyCounter.limitCount,
        remaining: Math.max(0, remaining),
      };

      if (monthlyCounter.currentCount >= monthlyCounter.limitCount) {
        console.log(
          `[AccessCheck] Monthly quota exceeded - User ${userId}, featureId: ${featureId}, current: ${monthlyCounter.currentCount}, limit: ${monthlyCounter.limitCount}`
        );
        return {
          allowed: false,
          reason: 'quota_exceeded',
          usage,
          limitType: 'monthly',
          userContext: { tenantId, userId },
        };
      }
      console.log(
        `[AccessCheck] Monthly quota check passed - remaining: ${remaining}`
      );
    } else {
      console.log(`[AccessCheck] No monthly limit configured for ${featureId}`);
    }

    // 回数制限がない（unlimitedまたは制限なしプラン）
    console.log(
      `[AccessCheck] Access granted - User ${userId}, featureId: ${featureId}, limitType: ${limitType}`
    );
    return {
      allowed: true,
      usage: Object.keys(usage).length > 0 ? usage : undefined,
      limitType,
      userContext: { tenantId, userId },
    };
  } catch (error) {
    console.error('[AccessCheck] DynamoDB quota check failed:', error);
    // DynamoDBアクセスエラーの場合は、OpenFGAで許可されていれば通す（回数制限なしとして扱う）
    console.warn(
      '[AccessCheck] Proceeding without quota check due to DynamoDB error (treating as unlimited)'
    );
    return {
      allowed: true,
      limitType: 'unlimited',
      userContext: { tenantId, userId },
    };
  }
}

/**
 * 使用回数をカウントアップする
 *
 * @param idToken - Cognito ID Token
 * @param resourceType - リソースの種別（例: 'llm'）
 * @param resourceId - リソースのID（例: 'gemini-2.5-flash'）
 * @param limitType - 回数制限のタイプ（checkAccessWithQuotaの結果から取得）
 */
export async function incrementUsage(
  idToken: string,
  resourceType: ResourceType,
  resourceId: string,
  limitType: 'unlimited' | 'daily' | 'monthly'
): Promise<void> {
  const featureId = buildFeatureId(resourceType, resourceId);

  console.log(
    `[IncrementUsage] Start - featureId: ${featureId}, limitType: ${limitType}`
  );

  // unlimitedの場合はカウントアップ不要
  if (limitType === 'unlimited') {
    console.log(
      `[IncrementUsage] Skipping increment for unlimited feature: ${featureId}`
    );
    return;
  }

  const payload = await verifyToken(idToken);
  if (!payload) {
    console.error('[IncrementUsage] Invalid token for incrementUsage');
    return;
  }

  const tenantId = payload['custom:tenant_id'];
  const userId = payload['cognito:username'];

  if (!tenantId || !userId) {
    console.error(
      '[IncrementUsage] Missing tenantId or userId for incrementUsage'
    );
    return;
  }

  console.log(
    `[IncrementUsage] Parameters - tenantId: ${tenantId}, userId: ${userId}, featureId: ${featureId}, limitType: ${limitType}`
  );

  try {
    const dynamoDBClient = await createTenantDynamoDBClientFromToken(idToken);

    const usageCounterTableName = getTableName(
      'AuthUsageCounter',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    const usageCountRepository = new UsageCountRepository(
      dynamoDBClient,
      usageCounterTableName
    );

    const featureIdPeriod = `${featureId}#${limitType}`;

    console.log(
      `[IncrementUsage] Incrementing counter - tableName: ${usageCounterTableName}, userId: ${userId}, featureIdPeriod: ${featureIdPeriod}`
    );

    const newCount = await usageCountRepository.increment(
      userId,
      featureIdPeriod
    );

    console.log(
      `[IncrementUsage] Success - user: ${userId}, feature: ${featureId}, period: ${limitType}, newCount: ${newCount}`
    );
  } catch (error) {
    // カウントアップに失敗しても処理を止めない（ログのみ）
    console.error('[IncrementUsage] Failed to increment usage count:', error);
  }
}
