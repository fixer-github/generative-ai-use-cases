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
import { UsageEventRepository } from '../authorization/repositories/usageEventRepository';
import { PermissionGrantRepository } from '../authorization/repositories/permissionGrantRepository';

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
 * - assistant: アシスタント機能（例: chat）
 */
export type ResourceType = 'llm' | 'assistant';

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
 * 期間の開始時刻を計算する（日本時間基準）
 */
function getPeriodStartTime(periodType: 'daily' | 'monthly'): number {
  const JST_OFFSET = 9 * 60 * 60 * 1000; // 9時間のミリ秒
  const now = new Date();

  // 現在時刻をJSTに変換
  const nowJST = new Date(now.getTime() + JST_OFFSET);

  let startTimeJST: Date;

  if (periodType === 'daily') {
    // 今日の午前0時（JST）
    startTimeJST = new Date(nowJST);
    startTimeJST.setUTCHours(0, 0, 0, 0);
  } else {
    // 今月1日の午前0時（JST）
    startTimeJST = new Date(nowJST);
    startTimeJST.setUTCDate(1);
    startTimeJST.setUTCHours(0, 0, 0, 0);
  }

  // JSTからUTCに戻してミリ秒単位で返す
  const startTimeUTC = new Date(startTimeJST.getTime() - JST_OFFSET);
  return startTimeUTC.getTime();
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

    const usageEventTableName = getTableName(
      'AuthUsageEvent',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );
    const permissionGrantTableName = getTableName(
      'AuthPermissionGrant',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    const usageEventRepository = new UsageEventRepository(
      dynamoDBClient,
      usageEventTableName
    );
    const permissionGrantRepository = new PermissionGrantRepository(
      dynamoDBClient,
      permissionGrantTableName
    );

    console.log(
      `[AccessCheck] Fetching permission grants - tableName: ${permissionGrantTableName}, userId: ${userId}`
    );

    // ユーザの有効な権限付与を取得
    const activeGrants = await permissionGrantRepository.findByUserIdAndStatus(
      userId,
      'active'
    );

    // この機能に対する制限情報を探す
    let dailyLimit: number | null = null;
    let monthlyLimit: number | null = null;
    let limitType: AccessCheckResult['limitType'] = 'unlimited';

    for (const grant of activeGrants) {
      const feature = grant.features.find((f) => f.featureId === featureId);
      if (feature) {
        if (feature.limitType === 'daily' && feature.limitCount) {
          dailyLimit = feature.limitCount;
          limitType = 'daily';
        } else if (feature.limitType === 'monthly' && feature.limitCount) {
          monthlyLimit = feature.limitCount;
          limitType = 'monthly';
        } else if (feature.limitType === 'unlimited') {
          limitType = 'unlimited';
        }
      }
    }

    console.log(
      `[AccessCheck] Limit configuration - dailyLimit: ${dailyLimit}, monthlyLimit: ${monthlyLimit}, limitType: ${limitType}`
    );

    const usage: AccessCheckResult['usage'] = {};
    const now = Date.now();

    // 日次制限のチェック
    if (dailyLimit !== null) {
      const dailyStartTime = getPeriodStartTime('daily');
      const dailyCount = await usageEventRepository.countUsageInPeriod(
        userId,
        featureId,
        dailyStartTime,
        now
      );

      console.log(
        `[AccessCheck] Daily limit found - currentCount: ${dailyCount}, limitCount: ${dailyLimit}`
      );

      const remaining = dailyLimit - dailyCount;
      usage.daily = {
        current: dailyCount,
        limit: dailyLimit,
        remaining: Math.max(0, remaining),
      };

      if (dailyCount >= dailyLimit) {
        console.log(
          `[AccessCheck] Daily quota exceeded - User ${userId}, featureId: ${featureId}, current: ${dailyCount}, limit: ${dailyLimit}`
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
    if (monthlyLimit !== null) {
      const monthlyStartTime = getPeriodStartTime('monthly');
      const monthlyCount = await usageEventRepository.countUsageInPeriod(
        userId,
        featureId,
        monthlyStartTime,
        now
      );

      console.log(
        `[AccessCheck] Monthly limit found - currentCount: ${monthlyCount}, limitCount: ${monthlyLimit}`
      );

      const remaining = monthlyLimit - monthlyCount;
      usage.monthly = {
        current: monthlyCount,
        limit: monthlyLimit,
        remaining: Math.max(0, remaining),
      };

      if (monthlyCount >= monthlyLimit) {
        console.log(
          `[AccessCheck] Monthly quota exceeded - User ${userId}, featureId: ${featureId}, current: ${monthlyCount}, limit: ${monthlyLimit}`
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
 * 使用状況の型定義（getLatestUsageの戻り値）
 */
export type UsageInfo = {
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

/**
 * 最新の使用回数情報を取得する
 *
 * @param idToken - Cognito ID Token
 * @param resourceType - リソースの種別（例: 'llm'）
 * @param resourceId - リソースのID（例: 'gemini-2.5-flash'）
 * @returns 最新の使用回数情報
 */
export async function getLatestUsage(
  idToken: string,
  resourceType: ResourceType,
  resourceId: string
): Promise<UsageInfo | undefined> {
  const payload = await verifyToken(idToken);
  if (!payload) {
    console.error('[GetLatestUsage] Invalid token');
    return undefined;
  }

  const tenantId = payload['custom:tenant_id'];
  const userId = payload['cognito:username'];

  if (!tenantId || !userId) {
    console.error('[GetLatestUsage] Missing tenantId or userId in token claims');
    return undefined;
  }

  const featureId = buildFeatureId(resourceType, resourceId);

  try {
    const dynamoDBClient = await createTenantDynamoDBClientFromToken(idToken);

    const usageEventTableName = getTableName(
      'AuthUsageEvent',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );
    const permissionGrantTableName = getTableName(
      'AuthPermissionGrant',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    const usageEventRepository = new UsageEventRepository(
      dynamoDBClient,
      usageEventTableName
    );
    const permissionGrantRepository = new PermissionGrantRepository(
      dynamoDBClient,
      permissionGrantTableName
    );

    // ユーザの有効な権限付与を取得
    const activeGrants = await permissionGrantRepository.findByUserIdAndStatus(
      userId,
      'active'
    );

    // この機能に対する制限情報を探す
    let dailyLimit: number | null = null;
    let monthlyLimit: number | null = null;

    for (const grant of activeGrants) {
      const feature = grant.features.find((f) => f.featureId === featureId);
      if (feature) {
        if (feature.limitType === 'daily' && feature.limitCount) {
          dailyLimit = feature.limitCount;
        } else if (feature.limitType === 'monthly' && feature.limitCount) {
          monthlyLimit = feature.limitCount;
        }
      }
    }

    const usage: UsageInfo = {};
    const now = Date.now();

    // 日次使用回数を取得
    if (dailyLimit !== null) {
      const dailyStartTime = getPeriodStartTime('daily');
      const dailyCount = await usageEventRepository.countUsageInPeriod(
        userId,
        featureId,
        dailyStartTime,
        now
      );

      usage.daily = {
        current: dailyCount,
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - dailyCount),
      };
    }

    // 月次使用回数を取得
    if (monthlyLimit !== null) {
      const monthlyStartTime = getPeriodStartTime('monthly');
      const monthlyCount = await usageEventRepository.countUsageInPeriod(
        userId,
        featureId,
        monthlyStartTime,
        now
      );

      usage.monthly = {
        current: monthlyCount,
        limit: monthlyLimit,
        remaining: Math.max(0, monthlyLimit - monthlyCount),
      };
    }

    return Object.keys(usage).length > 0 ? usage : undefined;
  } catch (error) {
    console.error('[GetLatestUsage] Failed to get usage info:', error);
    return undefined;
  }
}

/**
 * 使用回数をカウントアップする（イベントを記録する）
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

  // unlimitedの場合はイベント記録不要
  if (limitType === 'unlimited') {
    console.log(
      `[IncrementUsage] Skipping event recording for unlimited feature: ${featureId}`
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

    const usageEventTableName = getTableName(
      'AuthUsageEvent',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    const usageEventRepository = new UsageEventRepository(
      dynamoDBClient,
      usageEventTableName
    );

    const now = Date.now();
    const ttl = Math.floor(now / 1000) + 120 * 24 * 60 * 60; // 120日後に自動削除

    console.log(
      `[IncrementUsage] Recording usage event - tableName: ${usageEventTableName}, userId: ${userId}, featureId: ${featureId}, timestamp: ${now}`
    );

    await usageEventRepository.recordEvent({
      userId,
      timestamp: now,
      featureId,
      ttl,
    });

    console.log(
      `[IncrementUsage] Success - user: ${userId}, feature: ${featureId}, timestamp: ${now}`
    );
  } catch (error) {
    // イベント記録に失敗しても処理を止めない（ログのみ）
    console.error('[IncrementUsage] Failed to record usage event:', error);
  }
}
