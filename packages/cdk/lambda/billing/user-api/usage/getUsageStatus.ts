/**
 * 利用状況確認API
 *
 * 複数の機能IDに対する利用可能状況と残り回数を一括取得します。
 * - OpenFGAで権限の有無を確認
 * - DynamoDBで利用回数と制限を確認
 * - 各featureIdに対してステータスを判定
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createTenantDynamoDBClient } from '../../../utils/tenantDynamoDBClient';
import { getTenantCredentials } from '../../../utils/tenantCredentials';
import { getTenantId, getUsername } from '../../../utils/tenantUtils';
import {
  GetUsageStatusRequest,
  GetUsageStatusResponse,
} from '../../../authorization/repositories/types';
import { UsageEventRepository } from '../../../authorization/repositories/usageEventRepository';
import { PermissionGrantRepository } from '../../../authorization/repositories/permissionGrantRepository';
import {
  getPeriodStartTime,
  getBillingPeriodStartTime,
} from '../../../utils/periodUtils';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { getOpenFgaConfig } from '../../../utils/tenantSsmParameters';
import { Credentials } from '@aws-sdk/client-sts';

/**
 * モデルIDに含まれる%3Aをコロンにアンエスケープする
 * フロントエンドから送信されたエスケープ済みfeatureIdを元の形式に戻す
 */
function unescapeFeatureId(featureId: string): string {
  return decodeURIComponent(featureId);
}

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
 * OpenFGA API Gatewayに署名付きリクエストを送信する
 */
async function makeSignedOpenFgaRequest(
  method: string,
  path: string,
  apiEndpoint: string,
  apiRegion: string,
  credentials: Credentials,
  body?: string
): Promise<string> {
  const url = new URL(apiEndpoint);
  const hostname = url.hostname;
  const protocol = url.protocol.replace(':', '');

  const request = new HttpRequest({
    method,
    protocol,
    hostname,
    path: `${url.pathname}${path}`.replace(/\/\//g, '/'),
    headers: {
      'Content-Type': 'application/json',
      host: hostname,
    },
    body,
  });

  const signer = new SignatureV4({
    credentials: {
      accessKeyId: credentials.AccessKeyId!,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken,
    },
    region: apiRegion,
    service: 'execute-api',
    sha256: Sha256,
  });

  const signedRequest = await signer.sign(request);

  const response = await fetch(
    `${protocol}://${hostname}${signedRequest.path}`,
    {
      method: signedRequest.method,
      headers: signedRequest.headers as HeadersInit,
      body: signedRequest.body,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenFGA API request failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return await response.text();
}

/**
 * featureIdのtype部分から適切なrelationを決定する
 */
function getRelationForFeatureType(featureId: string): string {
  const type = featureId.split(':')[0];

  switch (type) {
    case 'llm':
    case 'assistant':
    case 'prompt-media':
      return 'accessor';
    case 'feature':
      return 'enabled_user';
    default:
      return 'enabled_user';
  }
}

/**
 * 単一のfeatureIdに対してOpenFGAで権限チェックを実行
 */
async function checkOpenFgaPermission(
  userId: string,
  featureId: string,
  storeId: string,
  apiEndpoint: string,
  apiRegion: string,
  credentials: Credentials
): Promise<boolean> {
  const relation = getRelationForFeatureType(featureId);
  const checkBody = {
    tuple_key: {
      user: `user:${userId}`,
      relation,
      object: featureId,
    },
  };

  try {
    const checkResponse = await makeSignedOpenFgaRequest(
      'POST',
      `/stores/${storeId}/check`,
      apiEndpoint,
      apiRegion,
      credentials,
      JSON.stringify(checkBody)
    );

    const checkResult = JSON.parse(checkResponse);
    return checkResult.allowed === true;
  } catch (error) {
    console.error(`OpenFGA check failed for feature ${featureId}:`, error);
    // OpenFGAへのアクセスに失敗した場合は拒否する
    return false;
  }
}

/**
 * レスポンス用のヘルパー関数
 */
function createResponse(
  statusCode: number,
  body: unknown
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Get Usage Status API request received');

  try {
    // 1. 認証確認とリクエストボディの解析
    const tenantId = getTenantId(event);
    const userId = getUsername(event);

    if (!userId || userId === 'unknown') {
      return createResponse(401, {
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
      });
    }

    if (!event.body) {
      return createResponse(400, {
        message: 'リクエストボディが必要です',
        code: 'INVALID_REQUEST',
      });
    }

    const requestBody: GetUsageStatusRequest = JSON.parse(event.body);
    const { featureIds } = requestBody;

    if (!featureIds || !Array.isArray(featureIds) || featureIds.length === 0) {
      return createResponse(400, {
        message: 'featureIdsが必要です',
        code: 'INVALID_REQUEST',
      });
    }

    // featureIdsの数に上限を設ける（50件まで）
    if (featureIds.length > 50) {
      return createResponse(400, {
        message: 'featureIdsは最大50件までです',
        code: 'INVALID_REQUEST',
      });
    }

    console.log('Request from user:', { tenantId, userId, featureIds });

    // 2. テナント認証情報をAssumeRoleWithWebIdentity経由で取得
    const { credentials, tenant } = await getTenantCredentials(event);

    // 3. OpenFGA設定をSSM Parameter Storeから取得
    const openFgaConfig = await getOpenFgaConfig(
      tenantId,
      credentials,
      tenant.region
    );

    // 5. DynamoDBクライアントを作成
    const dynamoDBClient = await createTenantDynamoDBClient(event);
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

    // 各featureIdに対する制限情報をマップに格納
    const limitMap = new Map<
      string,
      {
        dailyLimit: number | null;
        monthlyLimit: number | null;
        billingPeriodLimit: number | null;
        billingPeriodStart: number | null;
      }
    >();

    for (const grant of activeGrants) {
      for (const feature of grant.features) {
        const existing = limitMap.get(feature.featureId) || {
          dailyLimit: null,
          monthlyLimit: null,
          billingPeriodLimit: null,
          billingPeriodStart: null,
        };

        if (feature.limitType === 'daily' && feature.limitCount) {
          existing.dailyLimit = feature.limitCount;
        } else if (feature.limitType === 'monthly' && feature.limitCount) {
          existing.monthlyLimit = feature.limitCount;
        } else if (feature.limitType === 'billing_period' && feature.limitCount) {
          existing.billingPeriodLimit = feature.limitCount;
          existing.billingPeriodStart = grant.periodStart ?? null;
        }

        limitMap.set(feature.featureId, existing);
      }
    }

    // 6. 各featureIdに対してOpenFGAチェックと利用回数取得を並列実行
    const results: GetUsageStatusResponse['results'] = {};
    const now = Date.now();

    await Promise.all(
      featureIds.map(async (escapedFeatureId) => {
        // フロントエンドからエスケープされたfeatureIdをアンエスケープ
        const featureId = unescapeFeatureId(escapedFeatureId);
        console.log('Processing featureId:', {
          escapedFeatureId,
          featureId,
          hasColon: featureId.includes(':'),
        });
        try {
          // OpenFGAで権限チェック
          const hasPermission = await checkOpenFgaPermission(
            userId,
            featureId,
            openFgaConfig.storeId,
            openFgaConfig.apiEndpoint,
            openFgaConfig.apiRegion,
            credentials
          );

          console.log('OpenFGA permission check result:', {
            featureId,
            hasPermission,
          });

          if (!hasPermission) {
            // 権限がない場合
            results[escapedFeatureId] = {
              status: 'no_permission',
              hasLimit: false,
            };
            return;
          }

          // 権限がある場合、利用回数を確認
          const limits = limitMap.get(featureId);

          // 回数制限がない場合（無制限）
          if (
            !limits ||
            (limits.dailyLimit === null &&
              limits.monthlyLimit === null &&
              limits.billingPeriodLimit === null)
          ) {
            results[escapedFeatureId] = {
              status: 'available',
              hasLimit: false,
            };
            return;
          }

          // 回数制限がある場合
          const usage: {
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
          } = {};

          // 日次制限のチェック
          if (limits.dailyLimit !== null) {
            const dailyStartTime = getPeriodStartTime('daily');
            const dailyCount = await usageEventRepository.countUsageInPeriod(
              userId,
              featureId,
              dailyStartTime,
              now
            );

            const remaining = limits.dailyLimit - dailyCount;
            usage.daily = {
              current: dailyCount,
              limit: limits.dailyLimit,
              remaining: Math.max(0, remaining),
            };

            if (dailyCount >= limits.dailyLimit) {
              // 日次制限超過
              results[escapedFeatureId] = {
                status: 'quota_exceeded',
                hasLimit: true,
                remaining: 0,
                limit: limits.dailyLimit,
                periodType: 'daily',
                usage,
              };
              return;
            }
          }

          // 月次制限のチェック
          if (limits.monthlyLimit !== null) {
            const monthlyStartTime = getPeriodStartTime('monthly');
            const monthlyCount = await usageEventRepository.countUsageInPeriod(
              userId,
              featureId,
              monthlyStartTime,
              now
            );

            const remaining = limits.monthlyLimit - monthlyCount;
            usage.monthly = {
              current: monthlyCount,
              limit: limits.monthlyLimit,
              remaining: Math.max(0, remaining),
            };

            if (monthlyCount >= limits.monthlyLimit) {
              // 月次制限超過
              results[escapedFeatureId] = {
                status: 'quota_exceeded',
                hasLimit: true,
                remaining: 0,
                limit: limits.monthlyLimit,
                periodType: 'monthly',
                usage,
              };
              return;
            }
          }

          // 請求期間制限のチェック
          if (limits.billingPeriodLimit !== null) {
            if (limits.billingPeriodStart === null) {
              console.error(
                `billing_period limit requires periodStart but it was not found - featureId: ${featureId}`
              );
              // periodStartがない場合はエラーとして権限なしとする
              results[escapedFeatureId] = {
                status: 'no_permission',
                hasLimit: false,
              };
              return;
            }

            const billingPeriodStartTime = getBillingPeriodStartTime(
              limits.billingPeriodStart
            );
            const billingPeriodCount =
              await usageEventRepository.countUsageInPeriod(
                userId,
                featureId,
                billingPeriodStartTime,
                now
              );

            const remaining = limits.billingPeriodLimit - billingPeriodCount;
            usage.billing_period = {
              current: billingPeriodCount,
              limit: limits.billingPeriodLimit,
              remaining: Math.max(0, remaining),
            };

            if (billingPeriodCount >= limits.billingPeriodLimit) {
              // 請求期間制限超過
              results[escapedFeatureId] = {
                status: 'quota_exceeded',
                hasLimit: true,
                remaining: 0,
                limit: limits.billingPeriodLimit,
                periodType: 'billing_period',
                usage,
              };
              return;
            }
          }

          // 制限内で利用可能
          // 最も制約が厳しい（残数が少ない）方の情報を使用
          let minRemaining: number | undefined;
          let limitPeriodType: 'daily' | 'monthly' | 'billing_period' | undefined;
          let limitCount: number | undefined;

          // 各制限タイプの残数を配列に集めて最小を見つける
          const limitInfos: Array<{
            remaining: number;
            periodType: 'daily' | 'monthly' | 'billing_period';
            limit: number;
          }> = [];

          if (usage.daily) {
            limitInfos.push({
              remaining: usage.daily.remaining,
              periodType: 'daily',
              limit: usage.daily.limit,
            });
          }
          if (usage.monthly) {
            limitInfos.push({
              remaining: usage.monthly.remaining,
              periodType: 'monthly',
              limit: usage.monthly.limit,
            });
          }
          if (usage.billing_period) {
            limitInfos.push({
              remaining: usage.billing_period.remaining,
              periodType: 'billing_period',
              limit: usage.billing_period.limit,
            });
          }

          if (limitInfos.length > 0) {
            // 残数が最小のものを選択
            const minInfo = limitInfos.reduce((min, curr) =>
              curr.remaining < min.remaining ? curr : min
            );
            minRemaining = minInfo.remaining;
            limitPeriodType = minInfo.periodType;
            limitCount = minInfo.limit;
          }

          results[escapedFeatureId] = {
            status: 'limited',
            hasLimit: true,
            remaining: minRemaining,
            limit: limitCount,
            periodType: limitPeriodType,
            usage,
          };
        } catch (error) {
          console.error(`Error processing feature ${featureId}:`, error);
          // エラーが発生した場合は安全側に倒して権限なしとする
          results[escapedFeatureId] = {
            status: 'no_permission',
            hasLimit: false,
          };
        }
      })
    );

    // 7. レスポンスを返す
    const response: GetUsageStatusResponse = {
      results,
    };

    console.log('Returning usage status:', JSON.stringify(response, null, 2));

    return createResponse(200, response);
  } catch (error) {
    console.error('Unexpected error in getUsageStatus:', error);

    return createResponse(500, {
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
