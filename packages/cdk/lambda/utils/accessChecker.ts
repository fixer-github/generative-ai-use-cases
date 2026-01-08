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
import {
  getPeriodStartTime,
  getBillingPeriodStartTime,
} from './periodUtils';

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
    billing_period?: {
      current: number;
      limit: number;
      remaining: number;
    };
  };
  /** 回数制限のタイプ（incrementUsageで使用） */
  limitType?: 'unlimited' | 'daily' | 'monthly' | 'billing_period';
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
 * - prompt-media: プロンプトに含めるメディア（例: image）
 */
export type ResourceType = 'llm' | 'assistant' | 'prompt-media';

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
 * @param requestedCount - 今回リクエストする利用回数（デフォルト: 1）
 * @returns AccessCheckResult - アクセス可否と使用状況
 */
export async function checkAccessWithQuota(
  idToken: string,
  resourceType: ResourceType,
  resourceId: string,
  requestedCount: number = 1
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
    let billingPeriodLimit: number | null = null;
    let billingPeriodStart: number | null = null;
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
        } else if (feature.limitType === 'billing_period' && feature.limitCount) {
          billingPeriodLimit = feature.limitCount;
          billingPeriodStart = grant.periodStart ?? null;
          limitType = 'billing_period';
        } else if (feature.limitType === 'unlimited') {
          limitType = 'unlimited';
        }
      }
    }

    console.log(
      `[AccessCheck] Limit configuration - dailyLimit: ${dailyLimit}, monthlyLimit: ${monthlyLimit}, billingPeriodLimit: ${billingPeriodLimit}, limitType: ${limitType}`
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
        `[AccessCheck] Daily limit found - currentCount: ${dailyCount}, limitCount: ${dailyLimit}, requestedCount: ${requestedCount}`
      );

      const remaining = dailyLimit - dailyCount;
      usage.daily = {
        current: dailyCount,
        limit: dailyLimit,
        remaining: Math.max(0, remaining),
      };

      if (dailyCount + requestedCount > dailyLimit) {
        console.log(
          `[AccessCheck] Daily quota exceeded - User ${userId}, featureId: ${featureId}, current: ${dailyCount}, requested: ${requestedCount}, limit: ${dailyLimit}`
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
        `[AccessCheck] Daily quota check passed - remaining: ${remaining}, requested: ${requestedCount}`
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
        `[AccessCheck] Monthly limit found - currentCount: ${monthlyCount}, limitCount: ${monthlyLimit}, requestedCount: ${requestedCount}`
      );

      const remaining = monthlyLimit - monthlyCount;
      usage.monthly = {
        current: monthlyCount,
        limit: monthlyLimit,
        remaining: Math.max(0, remaining),
      };

      if (monthlyCount + requestedCount > monthlyLimit) {
        console.log(
          `[AccessCheck] Monthly quota exceeded - User ${userId}, featureId: ${featureId}, current: ${monthlyCount}, requested: ${requestedCount}, limit: ${monthlyLimit}`
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
        `[AccessCheck] Monthly quota check passed - remaining: ${remaining}, requested: ${requestedCount}`
      );
    } else {
      console.log(`[AccessCheck] No monthly limit configured for ${featureId}`);
    }

    // 請求期間制限のチェック
    if (billingPeriodLimit !== null) {
      if (billingPeriodStart === null) {
        console.error(
          `[AccessCheck] billing_period limit requires periodStart but it was not found - featureId: ${featureId}`
        );
        // periodStartがない場合はエラーとして拒否
        return {
          allowed: false,
          reason: 'quota_exceeded',
          usage,
          limitType: 'billing_period',
          userContext: { tenantId, userId },
        };
      }

      const billingPeriodStartTime = getBillingPeriodStartTime(billingPeriodStart);
      const billingPeriodCount = await usageEventRepository.countUsageInPeriod(
        userId,
        featureId,
        billingPeriodStartTime,
        now
      );

      console.log(
        `[AccessCheck] Billing period limit found - currentCount: ${billingPeriodCount}, limitCount: ${billingPeriodLimit}, requestedCount: ${requestedCount}, periodStart: ${billingPeriodStart}`
      );

      const remaining = billingPeriodLimit - billingPeriodCount;
      usage.billing_period = {
        current: billingPeriodCount,
        limit: billingPeriodLimit,
        remaining: Math.max(0, remaining),
      };

      if (billingPeriodCount + requestedCount > billingPeriodLimit) {
        console.log(
          `[AccessCheck] Billing period quota exceeded - User ${userId}, featureId: ${featureId}, current: ${billingPeriodCount}, requested: ${requestedCount}, limit: ${billingPeriodLimit}`
        );
        return {
          allowed: false,
          reason: 'quota_exceeded',
          usage,
          limitType: 'billing_period',
          userContext: { tenantId, userId },
        };
      }
      console.log(
        `[AccessCheck] Billing period quota check passed - remaining: ${remaining}, requested: ${requestedCount}`
      );
    } else {
      console.log(`[AccessCheck] No billing_period limit configured for ${featureId}`);
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
  billing_period?: {
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
    let billingPeriodLimit: number | null = null;
    let billingPeriodStart: number | null = null;

    for (const grant of activeGrants) {
      const feature = grant.features.find((f) => f.featureId === featureId);
      if (feature) {
        if (feature.limitType === 'daily' && feature.limitCount) {
          dailyLimit = feature.limitCount;
        } else if (feature.limitType === 'monthly' && feature.limitCount) {
          monthlyLimit = feature.limitCount;
        } else if (feature.limitType === 'billing_period' && feature.limitCount) {
          billingPeriodLimit = feature.limitCount;
          billingPeriodStart = grant.periodStart ?? null;
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

    // 請求期間使用回数を取得
    if (billingPeriodLimit !== null && billingPeriodStart !== null) {
      const billingPeriodStartTime = getBillingPeriodStartTime(billingPeriodStart);
      const billingPeriodCount = await usageEventRepository.countUsageInPeriod(
        userId,
        featureId,
        billingPeriodStartTime,
        now
      );

      usage.billing_period = {
        current: billingPeriodCount,
        limit: billingPeriodLimit,
        remaining: Math.max(0, billingPeriodLimit - billingPeriodCount),
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
 * @param count - 記録するイベント数（デフォルト: 1）
 */
export async function incrementUsage(
  idToken: string,
  resourceType: ResourceType,
  resourceId: string,
  limitType: 'unlimited' | 'daily' | 'monthly' | 'billing_period',
  count: number = 1
): Promise<void> {
  const featureId = buildFeatureId(resourceType, resourceId);

  console.log(
    `[IncrementUsage] Start - featureId: ${featureId}, limitType: ${limitType}, count: ${count}`
  );

  // unlimitedの場合はイベント記録不要
  if (limitType === 'unlimited') {
    console.log(
      `[IncrementUsage] Skipping event recording for unlimited feature: ${featureId}`
    );
    return;
  }

  // countが0以下の場合は何もしない
  if (count <= 0) {
    console.log(
      `[IncrementUsage] Skipping event recording for count: ${count}`
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
    `[IncrementUsage] Parameters - tenantId: ${tenantId}, userId: ${userId}, featureId: ${featureId}, limitType: ${limitType}, count: ${count}`
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

    const ttl = Math.floor(Date.now() / 1000) + 120 * 24 * 60 * 60; // 120日後に自動削除

    console.log(
      `[IncrementUsage] Recording ${count} usage event(s) - tableName: ${usageEventTableName}, userId: ${userId}, featureId: ${featureId}`
    );

    // count回分のイベントを記録する
    for (let i = 0; i < count; i++) {
      const now = Date.now();
      await usageEventRepository.recordEvent({
        userId,
        timestamp: now,
        featureId,
        ttl,
      });
    }

    console.log(
      `[IncrementUsage] Success - user: ${userId}, feature: ${featureId}, count: ${count}`
    );
  } catch (error) {
    // イベント記録に失敗しても処理を止めない（ログのみ）
    console.error('[IncrementUsage] Failed to record usage event:', error);
  }
}
