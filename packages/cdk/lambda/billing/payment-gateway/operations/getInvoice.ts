import Stripe from 'stripe';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { PlatformType } from '../repositories/types';

/**
 * Lambda関数ハンドラーのイベント型
 */
interface GetInvoiceEvent {
  platformType: PlatformType;
  invoiceId?: string; // Stripeのみ
  subscriptionId?: string; // Apple/Google用
  tenantId: string;
}

/**
 * Lambda関数ハンドラーのレスポンス型
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
  event: GetInvoiceEvent
): Promise<GetInvoiceResponse> {
  console.log('Get invoice request:', event);

  try {
    const { platformType, invoiceId, subscriptionId, tenantId } = event;

    switch (platformType) {
      case 'stripe':
        if (!invoiceId) {
          throw new Error('invoiceId is required for Stripe');
        }
        return getStripeInvoice(invoiceId, tenantId);

      case 'apple':
        return getAppleInvoiceLink();

      case 'google':
        return getGoogleInvoiceLink();

      default:
        throw new Error(`Unsupported platform type: ${platformType}`);
    }
  } catch (error) {
    console.error('Error getting invoice:', error);
    throw error;
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

  const stripe = new Stripe(secret.apiKey, { apiVersion: '2024-11-20.acacia' });

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
