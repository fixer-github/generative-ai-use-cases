/**
 * 権限チェックLambda関数
 * Check Permission Lambda Function
 *
 * OpenFGAとDynamoDBに問い合わせて、ユーザが機能を使えるか判定します
 */

import { Context } from 'aws-lambda';
import { createTenantDynamoDBClientForBackgroundJob } from '../utils/tenantDynamoDBClient';
import { getTenant } from '../tenantManager';
import {
  CheckPermissionRequest,
  CheckPermissionResponse,
} from './repositories/types';
import { UsageEventRepository } from './repositories/usageEventRepository';
import { PermissionGrantRepository } from './repositories/permissionGrantRepository';
import {
  getPeriodStartTime,
  getBillingPeriodStartTime,
} from '../utils/periodUtils';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { getOpenFgaConfig } from '../utils/tenantSsmParameters';

const stsClient = new STSClient();

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
    AccessKeyId: string;
    SecretAccessKey: string;
    SessionToken?: string;
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
  event: CheckPermissionRequest,
  _context: Context
): Promise<CheckPermissionResponse> => {
  console.log('Check Permission Request:', JSON.stringify(event, null, 2));

  const { tenantId, userId, featureId } = event;

  try {
    // 1. バリデーション
    if (!tenantId || !userId || !featureId) {
      throw new Error(
        'Missing required parameters: tenantId, userId, featureId'
      );
    }

    // 2. テナント情報の取得
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    // 3. テナントロールを AssumeRole してクレデンシャルを取得
    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: tenant.roleArn,
      RoleSessionName: `CheckPermission-${userId}-${featureId}`,
    });

    const assumeRoleResponse = await stsClient.send(assumeRoleCommand);
    if (!assumeRoleResponse.Credentials) {
      throw new Error(`Failed to assume role for tenant: ${tenantId}`);
    }

    const credentials = {
      AccessKeyId: assumeRoleResponse.Credentials.AccessKeyId!,
      SecretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey!,
      SessionToken: assumeRoleResponse.Credentials.SessionToken,
    };

    // 4. OpenFGA設定をSSM Parameter Storeから取得
    const openFgaConfig = await getOpenFgaConfig(
      tenantId,
      assumeRoleResponse.Credentials,
      tenant.region
    );

    // 5. OpenFGAに権限の有無を問い合わせ
    const checkBody = {
      tuple_key: {
        user: `user:${userId}`,
        relation: 'can_access',
        object: `feature:${featureId}`,
      },
    };

    console.log(
      'Checking permission in OpenFGA:',
      JSON.stringify(checkBody, null, 2)
    );

    let hasPermission = false;

    try {
      const checkResponse = await makeSignedOpenFgaRequest(
        'POST',
        `/stores/${openFgaConfig.storeId}/check`,
        openFgaConfig.apiEndpoint,
        openFgaConfig.apiRegion,
        credentials,
        JSON.stringify(checkBody)
      );

      const checkResult = JSON.parse(checkResponse);
      hasPermission = checkResult.allowed === true;

      console.log(
        `OpenFGA check result for user ${userId}, feature ${featureId}: ${hasPermission}`
      );
    } catch (openFgaError) {
      console.error('OpenFGA check failed:', openFgaError);
      // OpenFGAへのアクセスに失敗した場合は拒否する
      return {
        allowed: false,
        reason: 'no_permission',
      };
    }

    if (!hasPermission) {
      return {
        allowed: false,
        reason: 'no_permission',
      };
    }

    // 6. DynamoDBから権限付与情報を取得して、回数制限をチェック
    const dynamoDBClient =
      await createTenantDynamoDBClientForBackgroundJob(tenantId);

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

    const usage: CheckPermissionResponse['usage'] = {};
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

      const remaining = dailyLimit - dailyCount;
      usage.daily = {
        current: dailyCount,
        limit: dailyLimit,
        remaining: Math.max(0, remaining),
      };

      if (dailyCount >= dailyLimit) {
        console.log(
          `User ${userId} has exceeded daily quota for feature ${featureId} (${dailyCount}/${dailyLimit})`
        );
        return {
          allowed: false,
          reason: 'quota_exceeded',
          usage,
        };
      }
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

      const remaining = monthlyLimit - monthlyCount;
      usage.monthly = {
        current: monthlyCount,
        limit: monthlyLimit,
        remaining: Math.max(0, remaining),
      };

      if (monthlyCount >= monthlyLimit) {
        console.log(
          `User ${userId} has exceeded monthly quota for feature ${featureId} (${monthlyCount}/${monthlyLimit})`
        );
        return {
          allowed: false,
          reason: 'quota_exceeded',
          usage,
        };
      }
    }

    // 請求期間制限のチェック
    if (billingPeriodLimit !== null) {
      if (billingPeriodStart === null) {
        console.error(
          `billing_period limit requires periodStart but it was not found - featureId: ${featureId}`
        );
        // periodStartがない場合はエラーとして拒否
        return {
          allowed: false,
          reason: 'quota_exceeded',
          usage,
        };
      }

      const billingPeriodStartTime = getBillingPeriodStartTime(billingPeriodStart);
      const billingPeriodCount = await usageEventRepository.countUsageInPeriod(
        userId,
        featureId,
        billingPeriodStartTime,
        now
      );

      const remaining = billingPeriodLimit - billingPeriodCount;
      usage.billing_period = {
        current: billingPeriodCount,
        limit: billingPeriodLimit,
        remaining: Math.max(0, remaining),
      };

      if (billingPeriodCount >= billingPeriodLimit) {
        console.log(
          `User ${userId} has exceeded billing_period quota for feature ${featureId} (${billingPeriodCount}/${billingPeriodLimit})`
        );
        return {
          allowed: false,
          reason: 'quota_exceeded',
          usage,
        };
      }
    }

    // 7. すべての制限チェックが OK なら許可
    console.log(`User ${userId} is allowed to access feature ${featureId}`);

    const response: CheckPermissionResponse = {
      allowed: true,
      usage: Object.keys(usage).length > 0 ? usage : undefined,
    };

    console.log(
      'Check Permission Response:',
      JSON.stringify(response, null, 2)
    );

    return response;
  } catch (error) {
    console.error('Error in checkPermission:', error);
    // エラーが発生した場合は安全側に倒して拒否する
    return {
      allowed: false,
      reason: 'no_permission',
    };
  }
};
