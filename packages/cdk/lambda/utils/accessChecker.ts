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

/**
 * 総使用回数の上限（固定値）
 */
const TOTAL_USAGE_LIMIT = 30;

/**
 * アクセスチェック結果の型定義
 */
export interface AccessCheckResult {
  allowed: boolean;
  reason?: 'no_permission' | 'quota_exceeded' | 'invalid_token';
  usage?: {
    total: {
      current: number;
      limit: number;
      remaining: number;
    };
  };
  /** 回数制限のタイプ（incrementUsageで使用） */
  limitType?: 'unlimited' | 'limited';
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

  // 3. DynamoDBで総使用回数チェック（30回制限）
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

    console.log(
      `[AccessCheck] Fetching total usage count - tableName: ${usageEventTableName}, userId: ${userId}`
    );

    // 総使用回数をカウント（期間制限なし）
    const totalCount = await usageEventRepository.countTotalUsage(userId);

    console.log(
      `[AccessCheck] Total usage count - currentCount: ${totalCount}, limit: ${TOTAL_USAGE_LIMIT}`
    );

    const remaining = TOTAL_USAGE_LIMIT - totalCount;
    const usage = {
      total: {
        current: totalCount,
        limit: TOTAL_USAGE_LIMIT,
        remaining: Math.max(0, remaining),
      },
    };

    if (totalCount >= TOTAL_USAGE_LIMIT) {
      console.log(
        `[AccessCheck] Total quota exceeded - User ${userId}, current: ${totalCount}, limit: ${TOTAL_USAGE_LIMIT}`
      );
      return {
        allowed: false,
        reason: 'quota_exceeded',
        usage,
        limitType: 'limited',
        userContext: { tenantId, userId },
      };
    }

    console.log(
      `[AccessCheck] Access granted - User ${userId}, remaining: ${remaining}`
    );
    return {
      allowed: true,
      usage,
      limitType: 'limited',
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
 * インクリメント後の使用状況レスポンスの型定義
 */
export interface IncrementUsageResult {
  featureId: string;
  total: {
    current: number;
    limit: number;
    remaining: number;
  };
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
  limitType: 'unlimited' | 'limited'
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
    const ttl = Math.floor(now / 1000) + 365 * 24 * 60 * 60; // 1年後に自動削除

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

/**
 * 使用回数をカウントアップし、インクリメント後の最新の使用状況を返却する
 *
 * @param idToken - Cognito ID Token
 * @param resourceType - リソースの種別（例: 'llm'）
 * @param resourceId - リソースのID（例: 'gemini-2.5-flash'）
 * @param limitType - 回数制限のタイプ（checkAccessWithQuotaの結果から取得）
 * @returns インクリメント後の最新の使用状況（unlimited の場合は undefined）
 */
export async function incrementUsageAndGetStatus(
  idToken: string,
  resourceType: ResourceType,
  resourceId: string,
  limitType: 'unlimited' | 'limited'
): Promise<IncrementUsageResult | undefined> {
  const featureId = buildFeatureId(resourceType, resourceId);

  console.log(
    `[IncrementUsageAndGetStatus] Start - featureId: ${featureId}, limitType: ${limitType}`
  );

  // unlimitedの場合はイベント記録不要、usageも返さない
  if (limitType === 'unlimited') {
    console.log(
      `[IncrementUsageAndGetStatus] Skipping for unlimited feature: ${featureId}`
    );
    return undefined;
  }

  const payload = await verifyToken(idToken);
  if (!payload) {
    console.error('[IncrementUsageAndGetStatus] Invalid token');
    return undefined;
  }

  const tenantId = payload['custom:tenant_id'];
  const userId = payload['cognito:username'];

  if (!tenantId || !userId) {
    console.error('[IncrementUsageAndGetStatus] Missing tenantId or userId');
    return undefined;
  }

  console.log(
    `[IncrementUsageAndGetStatus] Parameters - tenantId: ${tenantId}, userId: ${userId}, featureId: ${featureId}, limitType: ${limitType}`
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
    const ttl = Math.floor(now / 1000) + 365 * 24 * 60 * 60; // 1年後に自動削除

    // 1. 使用イベントを記録
    console.log(
      `[IncrementUsageAndGetStatus] Recording usage event - tableName: ${usageEventTableName}, userId: ${userId}, featureId: ${featureId}, timestamp: ${now}`
    );

    await usageEventRepository.recordEvent({
      userId,
      timestamp: now,
      featureId,
      ttl,
    });

    console.log('[IncrementUsageAndGetStatus] Usage event recorded successfully');

    // 2. インクリメント後の総使用回数を取得
    const totalCount = await usageEventRepository.countTotalUsage(userId);

    const result: IncrementUsageResult = {
      featureId,
      total: {
        current: totalCount,
        limit: TOTAL_USAGE_LIMIT,
        remaining: Math.max(0, TOTAL_USAGE_LIMIT - totalCount),
      },
    };

    console.log(
      `[IncrementUsageAndGetStatus] Total usage - current: ${totalCount}, limit: ${TOTAL_USAGE_LIMIT}, remaining: ${result.total.remaining}`
    );

    return result;
  } catch (error) {
    console.error('[IncrementUsageAndGetStatus] Failed:', error);
    return undefined;
  }
}
