/**
 * Store Info API
 *
 * フロントエンドがStripeなどの外部サービスと連携するために必要な
 * 公開可能な設定情報を返すAPI。
 * パブリッシュキーのみを返し、シークレットキーは返しません。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId } from '../../../utils/tenantUtils';

/**
 * レスポンスボディの型
 */
interface StoreInfoResponse {
  stripePublishableKey: string | null;
  tenantId: string;
}

/**
 * シークレットのキャッシュ
 */
let publishableKeyCache: { [key: string]: string } = {};

/**
 * Secrets ManagerからStripe パブリッシュキーを取得する
 */
async function getStripePublishableKey(tenantId: string): Promise<string | null> {
  if (publishableKeyCache[tenantId]) {
    return publishableKeyCache[tenantId];
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  try {
    const response = await client.send(command);

    if (!response.SecretString) {
      console.log(`Secret ${secretName} is empty`);
      return null;
    }

    const secret = JSON.parse(response.SecretString);

    if (!secret.publishableKey || secret.publishableKey === 'REPLACE_WITH_ACTUAL_STRIPE_PUBLISHABLE_KEY') {
      console.log(`Publishable key not configured for tenant ${tenantId}`);
      return null;
    }

    publishableKeyCache[tenantId] = secret.publishableKey;

    return secret.publishableKey;
  } catch (error) {
    console.error('Failed to retrieve Stripe publishable key:', error);
    return null;
  }
}

/**
 * CORSヘッダー
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'OPTIONS,GET',
};

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Get Store Info request received');

  try {
    // 1. テナントIDを取得
    const tenantId = getTenantId(event);

    if (!tenantId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'TENANT_NOT_FOUND',
            message: 'Tenant ID could not be determined',
          },
        }),
      };
    }

    // 2. Stripe パブリッシュキーを取得
    const stripePublishableKey = await getStripePublishableKey(tenantId);

    // 3. レスポンスを作成
    const response: StoreInfoResponse = {
      stripePublishableKey,
      tenantId,
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error in getStoreInfo:', error);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
        },
      }),
    };
  }
};
