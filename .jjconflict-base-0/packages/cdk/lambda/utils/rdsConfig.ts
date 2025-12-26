/**
 * RDS接続設定を取得するユーティリティ関数（IAM認証方式）
 * SSM Parameter Storeから取得する方式に変更
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { RdsConfig } from '../repositories/types';
import { getTenantCredentials } from './tenantCredentials';
import { extractTenantId } from './assumeRoleWithWebIdentity';
import { getRdsConfig as getSsmRdsConfig } from './tenantSsmParameters';

// キャッシュ（同一テナントへの連続アクセスを最適化）
// Structure: Map<tenantId, { config: RdsConfig, timestamp: number }>
const rdsConfigCache = new Map<
  string,
  { config: RdsConfig; timestamp: number }
>();

// Cache TTL: 5 minutes (same as SSM parameter cache)
const CACHE_TTL = 300000;

/**
 * SSM Parameter StoreからテナントのRDS接続情報を取得
 *
 * @param event API Gateway イベント
 * @returns RDS接続設定
 */
export async function getRdsConfig(
  event: APIGatewayProxyEvent
): Promise<RdsConfig> {
  // 1. テナントIDを取得
  const tenantId = extractTenantId(event);

  // 2. キャッシュチェック
  const cached = rdsConfigCache.get(tenantId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Using cached RDS config for tenant ${tenantId}`);
    return cached.config;
  }

  try {
    console.log(
      `Retrieving RDS config for tenant ${tenantId} from SSM Parameter Store`
    );

    // 3. テナント専用のIAMクレデンシャルを取得
    const { credentials, region } = await getTenantCredentials(event);

    // 4. SSM Parameter StoreからRDS設定を取得
    const rdsConfig = await getSsmRdsConfig(tenantId, credentials, region);

    // 5. キャッシュ更新
    rdsConfigCache.set(tenantId, {
      config: rdsConfig,
      timestamp: Date.now(),
    });

    console.log(
      `Successfully retrieved RDS config for tenant ${tenantId} from SSM`
    );
    return rdsConfig;
  } catch (error) {
    console.error(
      `Failed to retrieve RDS config for tenant ${tenantId}:`,
      error
    );
    throw error;
  }
}
