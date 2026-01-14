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
import {
  ok200Response,
  badRequest400Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

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
      return badRequest400Response({
        message: 'Tenant ID could not be determined',
        code: 'TENANT_NOT_FOUND',
        details: undefined,
      });
    }

    // 2. Stripe パブリッシュキーを取得
    const stripePublishableKey = await getStripePublishableKey(tenantId);

    // 3. レスポンスを作成
    const response: StoreInfoResponse = {
      stripePublishableKey,
      tenantId,
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error in getStoreInfo:', error);

    return internalServerError500Response({
      message: 'An internal error occurred',
      code: 'INTERNAL_ERROR',
      details: undefined,
    });
  }
};
