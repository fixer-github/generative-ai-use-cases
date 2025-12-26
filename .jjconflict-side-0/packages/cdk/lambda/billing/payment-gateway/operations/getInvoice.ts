import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { PlatformType } from '../repositories/types';
import { getTenantId } from '../../../utils/tenantUtils';

/**
 * レスポンスボディの型
 */
interface GetInvoiceResponse {
  invoiceUrl: string;
  isPdf: boolean; // PDFとして直接ダウンロードできるか
}

/**
 * シークレットのキャッシュ
 */
const secretsCache: Record<string, any> = {};

/**
 * Secrets Managerからシークレットを取得する
 */
async function getSecret(secretName: string): Promise<any> {
  if (secretsCache[secretName]) {
    return secretsCache[secretName];
  }

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  secretsCache[secretName] = secret;

  return secret;
}

/**
 * Lambda関数のメインハンドラー
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log('Get invoice request received');

  try {
    // 1. Cognitoの認証情報からテナントIDを取得
    const tenantId = getTenantId(event);

    // 2. クエリパラメータを取得
    const platformType = event.queryStringParameters?.platformType as
      | PlatformType
      | undefined;
    const invoiceId = event.queryStringParameters?.invoiceId;
    const subscriptionId = event.queryStringParameters?.subscriptionId;

    if (!platformType) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'platformType is required' }),
      };
    }

    console.log('Get invoice request:', {
      platformType,
      invoiceId,
      tenantId,
    });

    // 3. プラットフォームごとに請求書を取得
    let result;
    switch (platformType) {
      case 'stripe':
        if (!invoiceId) {
          return {
            statusCode: 400,
            body: JSON.stringify({ error: 'invoiceId is required for Stripe' }),
          };
        }
        result = await getStripeInvoice(invoiceId, tenantId);
        break;

      case 'apple':
        result = getAppleInvoiceLink();
        break;

      case 'google':
        result = getGoogleInvoiceLink();
        break;

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `Unsupported platform type: ${platformType}`,
          }),
        };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Error getting invoice:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

/**
 * Stripeの請求書PDFを取得する
 */
async function getStripeInvoice(
  invoiceId: string,
  tenantId: string
): Promise<GetInvoiceResponse> {
  const secretName = `${tenantId}/billing/stripe`;
  const secret = await getSecret(secretName);

  const stripe = new Stripe(secret.apiKey, { apiVersion: '2025-10-29.clover' });

  const invoice = await stripe.invoices.retrieve(invoiceId);

  if (!invoice.invoice_pdf) {
    throw new Error('Invoice PDF not available');
  }

  return {
    invoiceUrl: invoice.invoice_pdf,
    isPdf: true,
  };
}

/**
 * Appleの請求情報ページへのリンクを返す
 */
function getAppleInvoiceLink(): GetInvoiceResponse {
  // Appleの場合、請求書はApp Storeの購入履歴から確認できる
  return {
    invoiceUrl: 'https://finance-app.itunes.apple.com/',
    isPdf: false,
  };
}

/**
 * Googleの請求情報ページへのリンクを返す
 */
function getGoogleInvoiceLink(): GetInvoiceResponse {
  // Googleの場合、請求書はGoogle Playの注文履歴から確認できる
  return {
    invoiceUrl: 'https://play.google.com/store/account/orderhistory',
    isPdf: false,
  };
}
