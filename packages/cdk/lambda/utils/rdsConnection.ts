/**
 * RDS接続ヘルパー関数（IAM認証方式）
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { Signer } from '@aws-sdk/rds-signer';
import { getTenantCredentials } from './tenantCredentials';
import { extractTenantId } from './assumeRoleWithWebIdentity';
import { getRdsConfig } from './rdsConfig';

/**
 * RDS接続設定（パスワード含む）
 */
export interface RdsConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string; // IAM認証トークン
  ssl: {
    rejectUnauthorized: boolean;
  };
}

/**
 * テナント固有のRDS接続設定を取得（IAM認証トークン付き）
 *
 * @param event API Gateway イベント
 * @returns RDS接続設定（IAM認証トークン付き）
 */
export async function getRdsConnection(
  event: APIGatewayProxyEvent
): Promise<RdsConnectionConfig> {
  // 1. テナントIDを取得
  const tenantId = extractTenantId(event);

  // 2. TenantsテーブルからテナントのRDS接続情報を取得
  const rdsConfig = await getRdsConfig(tenantId);

  // 3. テナント専用のIAMクレデンシャルを取得
  const { credentials } = await getTenantCredentials(event);

  // 4. IAM認証トークンを生成
  const authToken = await generateRdsAuthToken({
    hostname: rdsConfig.proxyEndpoint,
    port: rdsConfig.port,
    username: rdsConfig.username,
    region: rdsConfig.region,
    credentials: credentials,
  });

  // 5. RDS接続設定を返す
  return {
    host: rdsConfig.proxyEndpoint,
    port: rdsConfig.port,
    database: rdsConfig.database,
    user: rdsConfig.username,
    password: authToken, // IAM認証トークンをパスワードとして使用
    ssl: {
      rejectUnauthorized: true,
    },
  };
}

/**
 * RDS IAM認証トークンを生成
 *
 * @param params トークン生成パラメータ
 * @returns IAM認証トークン（15分間有効）
 */
async function generateRdsAuthToken(params: {
  hostname: string;
  port: number;
  username: string;
  region: string;
  credentials: any;
}): Promise<string> {
  const signer = new Signer({
    hostname: params.hostname,
    port: params.port,
    username: params.username,
    region: params.region,
    credentials: params.credentials,
  });

  return await signer.getAuthToken();
}
