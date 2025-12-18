/**
 * Send Checkout Link to Parent API
 *
 * ペアレンタルコントロール用のCheckout Session作成API。
 * 保護者のメールアドレスを受け取り、決済リンクをメールで送信します。
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import { Plan } from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

const SERVICE_NAME = process.env.SERVICE_NAME || 'GenU';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || '';
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

/**
 * カラーテーマ（既存のメールテンプレートと統一）
 */
const COLORS = {
  primary: '#232F3E',
  accent: '#2074d5',
  orange: '#ff9900',
  background: '#f5f5f5',
  white: '#ffffff',
  text: '#333333',
  lightGray: '#e0e0e0',
};

/**
 * リクエストボディの型
 */
interface SendCheckoutLinkRequest {
  planId: string;
  parentEmail: string;
  childName?: string; // 子供の名前（任意）
}

/**
 * シークレットのキャッシュ
 */
const stripeApiKeyCache: { [key: string]: string } = {};

/**
 * Secrets ManagerからStripe APIキーを取得する
 */
async function getStripeApiKey(tenantId: string): Promise<string> {
  if (stripeApiKeyCache[tenantId]) {
    return stripeApiKeyCache[tenantId];
  }

  const secretName = `${tenantId}/billing/stripe`;
  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  stripeApiKeyCache[tenantId] = secret.apiKey;

  return secret.apiKey;
}

/**
 * リクエストヘッダーからフロントエンドのベースURLを取得する
 */
function getBaseUrlFromRequest(event: APIGatewayProxyEvent): string {
  const headers = event.headers;

  const origin = headers['origin'] || headers['Origin'];
  if (origin) {
    return origin;
  }

  const referer = headers['referer'] || headers['Referer'];
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      // パース失敗時は続行
    }
  }

  throw new Error('Unable to determine frontend base URL from request headers');
}

/**
 * 共通HTMLメールレイアウト
 */
const createEmailHtml = (
  title: string,
  bodyContent: string,
  footerNote?: string
): string => {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Noto Sans JP', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif; background-color: ${COLORS.background};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${COLORS.background};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: ${COLORS.white}; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color: ${COLORS.primary}; padding: 24px 32px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: ${COLORS.white}; font-size: 24px; font-weight: bold;">${SERVICE_NAME}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              ${bodyContent}
            </td>
          </tr>
          <tr>
            <td style="background-color: ${COLORS.background}; padding: 20px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid ${COLORS.lightGray};">
              ${footerNote ? `<p style="margin: 0; font-size: 12px; color: #666;">${footerNote}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * プラン情報ブロック
 */
const createPlanInfoBlock = (
  planName: string,
  price: string,
  childName?: string
): string => {
  return `
    <div style="background-color: ${COLORS.background}; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        ${
          childName
            ? `<tr>
          <td style="padding: 8px 0;">
            <span style="font-size: 14px; color: #666;">お子様のお名前</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${childName}</span>
          </td>
        </tr>`
            : ''
        }
        <tr>
          <td style="padding: 8px 0; ${childName ? `border-top: 1px solid ${COLORS.lightGray};` : ''}">
            <span style="font-size: 14px; color: #666;">プラン名</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${planName}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-top: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">料金</span><br>
            <span style="font-size: 20px; font-weight: bold; color: ${COLORS.accent};">${price}</span>
          </td>
        </tr>
      </table>
    </div>
  `;
};

/**
 * 保護者向け決済リクエストメール作成
 */
const createParentPaymentRequestEmail = (
  checkoutUrl: string,
  planName: string,
  price: string,
  childName?: string
): { subject: string; htmlContent: string } => {
  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">サブスクリプション決済のお願い</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      ${childName ? `${childName}さんから` : 'お子様から'}${SERVICE_NAME}のサブスクリプション登録のリクエストがありました。<br>
      以下の内容をご確認の上、決済を完了してください。
    </p>
    ${createPlanInfoBlock(planName, price, childName)}
    <div style="text-align: center; margin: 24px 0;">
      <a href="${checkoutUrl}" style="display: inline-block; background-color: ${COLORS.accent}; color: ${COLORS.white}; text-decoration: none; padding: 16px 48px; border-radius: 6px; font-size: 16px; font-weight: bold;">決済ページへ進む</a>
    </div>
    <p style="margin: 24px 0 0 0; color: #666; font-size: 13px; line-height: 1.5;">
      <strong>ご注意:</strong><br>
      • このリンクは24時間有効です<br>
      • 決済完了後、サブスクリプションが有効になります<br>
      • 心当たりがない場合は、このメールを無視してください
    </p>
  `;

  const footerNote =
    'このメールは自動送信されています。返信には対応できません。';

  return {
    subject: `【${SERVICE_NAME}】サブスクリプション決済のお願い`,
    htmlContent: createEmailHtml(
      'サブスクリプション決済のお願い',
      bodyContent,
      footerNote
    ),
  };
};

/**
 * SendGridでメール送信
 */
const sendEmail = async (
  to: string,
  subject: string,
  htmlContent: string
): Promise<void> => {
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: SENDGRID_FROM_EMAIL },
    subject: subject,
    content: [{ type: 'text/html', value: htmlContent }],
  };

  const response = await fetch(SENDGRID_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `SendGrid API error: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  console.log(`Parent payment request email sent successfully to ${to}`);
};

/**
 * 料金フォーマット
 */
function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Send Checkout Link to Parent request received');

  try {
    // 1. 認証情報からユーザIDとテナントIDを取得
    const userId = getUserIdFromCognitoEvent(event);
    const tenantId = getTenantId(event);

    if (!userId || !tenantId) {
      console.error('Missing authentication information');
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
        details: undefined,
      });
    }

    console.log('Request context:', { userId, tenantId });

    // 2. リクエストボディを取得
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが必要です',
        code: 'MISSING_BODY',
        details: undefined,
      });
    }

    let requestBody: SendCheckoutLinkRequest;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
        details: undefined,
      });
    }

    const { planId, parentEmail, childName } = requestBody;

    if (!planId || !parentEmail) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          required: ['planId', 'parentEmail'],
        },
      });
    }

    // メールアドレスの簡易バリデーション
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(parentEmail)) {
      return badRequest400Response({
        message: '有効なメールアドレスを入力してください',
        code: 'INVALID_EMAIL',
        details: {
          field: 'parentEmail',
        },
      });
    }

    console.log('Creating checkout session for parental control:', {
      planId,
      parentEmail,
      childName,
    });

    // 3. プラン情報を取得
    const plan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: planId }
    );

    if (!plan) {
      console.error('Plan not found:', planId);
      return notFound404Response({
        message: '指定されたプランが見つかりません',
        code: 'PLAN_NOT_FOUND',
        details: { planId },
      });
    }

    // 4. プランのプラットフォームタイプを確認
    if (plan.platform_type !== 'stripe') {
      console.error('Invalid platform type:', {
        planId,
        platformType: plan.platform_type,
      });
      return badRequest400Response({
        message: 'このプランはWeb版での購入に対応していません',
        code: 'INVALID_PLATFORM',
        details: { planId, platformType: plan.platform_type },
      });
    }

    // 5. Stripe Price IDを取得
    const priceId = plan.platform_product_id;
    if (!priceId) {
      console.error('Price ID not configured for plan:', planId);
      return internalServerError500Response({
        message: 'プランの価格設定が正しく構成されていません',
        code: 'CONFIGURATION_ERROR',
        details: { planId },
      });
    }

    // 6. プランのステータスを確認
    if (plan.status === 'deprecated') {
      console.error('Plan is deprecated:', planId);
      return badRequest400Response({
        message: 'このプランは廃止されており、購入できません',
        code: 'PLAN_DEPRECATED',
        details: { planId },
      });
    }

    // 7. Stripe APIキーを取得
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 8. 価格情報を取得
    const price = await stripe.prices.retrieve(priceId);
    const formattedPrice = formatPrice(
      price.unit_amount || 0,
      price.currency || 'jpy'
    );

    // 9. return URLを設定（通常のCheckoutリダイレクト用）
    const baseUrl = getBaseUrlFromRequest(event);
    const successUrl = `${baseUrl}/billing/complete?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/billing/cancel`;

    // 10. Checkout Sessionを作成（リダイレクトモード）
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: parentEmail, // 保護者のメールを設定
      metadata: {
        userId,
        tenantId,
        planId,
        parentEmail, // 保護者メールをメタデータにも保存
        childName: childName || '',
        isParentalControl: 'true', // ペアレンタルコントロールフラグ
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      payment_method_types: ['card'],
      locale: 'ja',
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24時間後に期限切れ
    });

    console.log('Checkout Session created for parental control:', session.id);

    // 11. 保護者にメール送信
    const emailContent = createParentPaymentRequestEmail(
      session.url!,
      plan.plan_name,
      formattedPrice,
      childName
    );

    await sendEmail(parentEmail, emailContent.subject, emailContent.htmlContent);

    console.log('Parent payment request email sent:', {
      sessionId: session.id,
      parentEmail,
    });

    // 12. レスポンスを返す
    return ok200Response({
      message: '決済リンクを保護者のメールアドレスに送信しました',
      sessionId: session.id,
      expiresAt: session.expires_at,
    });
  } catch (error) {
    console.error('Error sending checkout link to parent:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return badRequest400Response({
        message: error.message,
        code: 'STRIPE_ERROR',
        details: {
          type: error.type,
          code: error.code,
        },
      });
    }

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: undefined,
    });
  }
};
