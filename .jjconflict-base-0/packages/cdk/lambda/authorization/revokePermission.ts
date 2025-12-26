/**
 * 権限剥奪Lambda関数
 * Revoke Permission Lambda Function
 *
 * OpenFGAとDynamoDBから権限情報を削除します
 */

import { Context } from 'aws-lambda';
import { createTenantDynamoDBClientForBackgroundJob } from '../utils/tenantDynamoDBClient';
import { getTenant } from '../tenantManager';
import {
  RevokePermissionRequest,
  RevokePermissionResponse,
} from './repositories/types';
import { PermissionGrantRepository } from './repositories/permissionGrantRepository';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { getOpenFgaConfig } from '../utils/tenantSsmParameters';

const stsClient = new STSClient();

/**
 * Entitlement IDを生成する
 * @param planId プランID
 * @returns Entitlement ID (plan-{planId} 形式)
 */
function generateEntitlementId(planId: string): string {
  return `plan-${planId}`;
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
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  },
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
    credentials,
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

export const handler = async (
  event: RevokePermissionRequest,
  _context: Context
): Promise<RevokePermissionResponse> => {
  console.log('Revoke Permission Request:', JSON.stringify(event, null, 2));

  const { tenantId, planId, sourceId } = event;

  try {
    // 1. バリデーション
    if (!tenantId || !planId || !sourceId) {
      throw new Error('Missing required parameters: tenantId, planId, sourceId');
    }

    // 2. テナント情報の取得
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    // 3. DynamoDBから権限付与情報を取得
    const dynamoDBClient =
      await createTenantDynamoDBClientForBackgroundJob(tenantId);

    const permissionGrantTableName = getTableName(
      'AuthPermissionGrant',
      tenantId,
      process.env.ENVIRONMENT || 'dev'
    );

    const permissionGrantRepository = new PermissionGrantRepository(
      dynamoDBClient,
      permissionGrantTableName
    );

    // 権限付与履歴を取得（sourceIdで検索）
    const permissionGrant = await permissionGrantRepository.findBySourceId(sourceId);
    if (!permissionGrant) {
      // sourceIdに対応するactiveな権限がない場合は、既に剥奪済みとみなして成功を返す（冪等性）
      console.warn(
        `No active permission grant found for sourceId ${sourceId}, assuming already revoked`
      );
      return {
        success: true,
        grantId: 'unknown',
        revokedAt: new Date().toISOString(),
      };
    }
    const grantId = permissionGrant.grantId;
    console.log(`Found grantId ${grantId} from sourceId ${sourceId}`);

    if (permissionGrant.status === 'revoked') {
      console.warn(`Permission grant ${grantId} is already revoked`);
      // 既に剥奪済みの場合も成功を返す（冪等性）
      return {
        success: true,
        grantId,
        revokedAt: new Date(permissionGrant.revokedAt! * 1000).toISOString(),
      };
    }

    const userId = permissionGrant.userId;

    // 4. テナントロールを AssumeRole してクレデンシャルを取得
    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: tenant.roleArn,
      RoleSessionName: `RevokePermission-${grantId}`,
    });

    const assumeRoleResponse = await stsClient.send(assumeRoleCommand);
    if (!assumeRoleResponse.Credentials) {
      throw new Error(`Failed to assume role for tenant: ${tenantId}`);
    }

    const credentials = {
      accessKeyId: assumeRoleResponse.Credentials.AccessKeyId!,
      secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey!,
      sessionToken: assumeRoleResponse.Credentials.SessionToken,
    };

    // 5. OpenFGA設定をSSM Parameter Storeから取得
    const openFgaConfig = await getOpenFgaConfig(
      tenantId,
      assumeRoleResponse.Credentials,
      tenant.region
    );

    // 6. OpenFGAから関係性を削除
    // user:{userId} → holder → entitlement:plan-{planId} を削除
    const entitlementId = generateEntitlementId(planId);
    const tupleKeys = [
      {
        user: `user:${userId}`,
        relation: 'holder',
        object: `entitlement:${entitlementId}`,
      },
    ];

    const deleteTuplesBody = {
      deletes: {
        tuple_keys: tupleKeys,
      },
    };

    console.log(
      'Deleting tuples from OpenFGA:',
      JSON.stringify(deleteTuplesBody, null, 2)
    );
    console.log(
      `Revoking holder relation from user ${userId} to entitlement:${entitlementId}`
    );

    try {
      await makeSignedOpenFgaRequest(
        'POST',
        `/stores/${openFgaConfig.storeId}/write`,
        openFgaConfig.apiEndpoint,
        openFgaConfig.apiRegion,
        credentials,
        JSON.stringify(deleteTuplesBody)
      );
    } catch (openFgaError) {
      console.error('OpenFGA delete failed:', openFgaError);
      throw new Error(`Failed to delete from OpenFGA: ${openFgaError}`);
    }

    // 7. 権限付与履歴の状態を更新
    const now = Math.floor(Date.now() / 1000);
    await permissionGrantRepository.updateStatus(grantId, 'revoked', now);

    console.log(`Permission grant ${grantId} revoked successfully`);

    // 8. 成功レスポンスを返す
    const response: RevokePermissionResponse = {
      success: true,
      grantId,
      revokedAt: new Date(now * 1000).toISOString(),
    };

    console.log(
      'Revoke Permission Response:',
      JSON.stringify(response, null, 2)
    );

    return response;
  } catch (error) {
    console.error('Error in revokePermission:', error);
    throw error;
  }
};
