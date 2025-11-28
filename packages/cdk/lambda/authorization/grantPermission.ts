/**
 * 権限付与Lambda関数
 * Grant Permission Lambda Function
 *
 * OpenFGAとDynamoDBに権限情報を登録します
 */

import { Context } from 'aws-lambda';
import { createTenantDynamoDBClientForBackgroundJob } from '../utils/tenantDynamoDBClient';
import { getTenant } from '../tenantManager';
import {
  GrantPermissionRequest,
  GrantPermissionResponse,
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
  event: GrantPermissionRequest,
  _context: Context
): Promise<GrantPermissionResponse> => {
  console.log('Grant Permission Request:', JSON.stringify(event, null, 2));

  const { tenantId, userId, grantId, planId, features, sourceType, sourceId } =
    event;

  try {
    // 1. バリデーション
    if (
      !tenantId ||
      !userId ||
      !grantId ||
      !planId ||
      !features ||
      !sourceType ||
      !sourceId
    ) {
      throw new Error(
        'Missing required parameters: tenantId, userId, grantId, planId, features, sourceType, sourceId'
      );
    }

    // 各featureのバリデーション
    for (const feature of features) {
      if (!feature.featureId || !feature.limitType) {
        throw new Error('Each feature must have featureId and limitType');
      }

      if (
        feature.limitType !== 'unlimited' &&
        (feature.limitCount === undefined || feature.limitCount <= 0)
      ) {
        throw new Error(
          `Feature ${feature.featureId}: limitCount is required and must be > 0 for limitType ${feature.limitType}`
        );
      }
    }

    // 2. テナント情報の取得
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    // 3. テナントロールを AssumeRole してクレデンシャルを取得
    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: tenant.roleArn,
      RoleSessionName: `GrantPermission-${grantId}`,
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

    // 4. OpenFGA設定をSSM Parameter Storeから取得
    const openFgaConfig = await getOpenFgaConfig(
      tenantId,
      assumeRoleResponse.Credentials,
      tenant.region
    );

    // 5. OpenFGAにユーザーとEntitlementの関係を登録
    // user:{userId} → holder → entitlement:plan-{planId}
    const entitlementId = generateEntitlementId(planId);
    const tupleKeys = [
      {
        user: `user:${userId}`,
        relation: 'holder',
        object: `entitlement:${entitlementId}`,
      },
    ];

    const writeTuplesBody = {
      writes: {
        tuple_keys: tupleKeys,
      },
    };

    console.log(
      'Writing tuples to OpenFGA:',
      JSON.stringify(writeTuplesBody, null, 2)
    );

    try {
      await makeSignedOpenFgaRequest(
        'POST',
        `/stores/${openFgaConfig.storeId}/write`,
        openFgaConfig.apiEndpoint,
        openFgaConfig.apiRegion,
        credentials,
        JSON.stringify(writeTuplesBody)
      );
      console.log(
        `User ${userId} granted holder relation to entitlement:${entitlementId}`
      );
    } catch (openFgaError) {
      console.error('OpenFGA write failed:', openFgaError);
      throw new Error(`Failed to write to OpenFGA: ${openFgaError}`);
    }

    // 6. DynamoDBに権限付与履歴を記録
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

    const now = Math.floor(Date.now() / 1000);

    try {
      console.log(
        `[GrantPermission] Recording permission grant - grantId: ${grantId}, userId: ${userId}, features: ${features.length}`
      );

      // 権限付与履歴をDynamoDBに記録
      await permissionGrantRepository.create({
        grantId,
        userId,
        features,
        status: 'active',
        sourceType,
        sourceId,
        grantedAt: now,
      });

      console.log(
        `[GrantPermission] Permission grant ${grantId} recorded successfully`
      );
    } catch (dynamoError) {
      // DynamoDBへの書き込みに失敗した場合、OpenFGAの関係性を削除してロールバック
      console.error(
        '[GrantPermission] DynamoDB write failed, rolling back OpenFGA tuples:',
        dynamoError
      );

      const deleteTuplesBody = {
        deletes: {
          tuple_keys: tupleKeys,
        },
      };

      try {
        await makeSignedOpenFgaRequest(
          'POST',
          `/stores/${openFgaConfig.storeId}/write`,
          openFgaConfig.apiEndpoint,
          openFgaConfig.apiRegion,
          credentials,
          JSON.stringify(deleteTuplesBody)
        );
        console.log('[GrantPermission] OpenFGA tuples rolled back successfully');
      } catch (rollbackError) {
        console.error(
          '[GrantPermission] Failed to rollback OpenFGA tuples:',
          rollbackError
        );
      }

      throw new Error(`Failed to write to DynamoDB: ${dynamoError}`);
    }

    // 7. 成功レスポンスを返す
    const response: GrantPermissionResponse = {
      success: true,
      grantId,
      grantedAt: new Date(now * 1000).toISOString(),
    };

    console.log(
      'Grant Permission Response:',
      JSON.stringify(response, null, 2)
    );

    return response;
  } catch (error) {
    console.error('Error in grantPermission:', error);
    throw error;
  }
};
