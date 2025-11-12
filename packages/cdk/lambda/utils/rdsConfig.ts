/**
 * RDS接続設定を取得するユーティリティ関数（IAM認証方式）
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { RdsConfig } from '../repositories/types';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION! });

// キャッシュ（同一テナントへの連続アクセスを最適化）
let cachedRdsConfig: RdsConfig | null = null;
let cachedTenantId: string | null = null;

/**
 * TenantsテーブルからテナントのRDS接続情報を取得
 *
 * @param tenantId テナントID
 * @returns RDS接続設定
 */
export async function getRdsConfig(tenantId: string): Promise<RdsConfig> {
  // キャッシュチェック
  if (cachedRdsConfig && cachedTenantId === tenantId) {
    console.log(`Using cached RDS config for tenant ${tenantId}`);
    return cachedRdsConfig;
  }

  const tenantsTableName = process.env.TENANTS_TABLE_NAME;

  if (!tenantsTableName) {
    throw new Error(
      'TENANTS_TABLE_NAME environment variable is required for multi-tenant RDS access'
    );
  }

  try {
    console.log(`Retrieving RDS config for tenant ${tenantId} from table ${tenantsTableName}`);

    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: tenantsTableName,
        Key: {
          tenantId: { S: tenantId },
        },
      })
    );

    if (!response.Item) {
      throw new Error(
        `Tenant ${tenantId} not found in tenants table. Ensure tenant is registered with RDS configuration.`
      );
    }

    const tenant = unmarshall(response.Item);

    // RDS接続情報の検証
    if (!tenant.rdsProxyEndpoint) {
      throw new Error(
        `RDS Proxy endpoint not configured for tenant ${tenantId}. Please run tenant RDS setup.`
      );
    }

    const rdsConfig: RdsConfig = {
      proxyEndpoint: tenant.rdsProxyEndpoint,
      database: tenant.rdsDatabase || 'billing',
      region: tenant.rdsRegion || process.env.AWS_REGION!,
      port: tenant.rdsPort || 5432,
      username: tenant.rdsUsername || 'db_iam_user',
    };

    // キャッシュ更新
    cachedRdsConfig = rdsConfig;
    cachedTenantId = tenantId;

    console.log(`Successfully retrieved RDS config for tenant ${tenantId}`);
    return rdsConfig;
  } catch (error) {
    console.error(`Failed to retrieve RDS config for tenant ${tenantId}:`, error);
    throw error;
  }
}
