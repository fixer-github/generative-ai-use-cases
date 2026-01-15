/**
 * Send Payment Method Update Link to Parent API
 *
 * ペアレンタルコントロール用の支払い方法更新API。
 * 認証済みユーザー（未成年）のトークンから顧客情報を取得し、
 * 保護者のメールアドレスにCustomer Portalリンクを送信します。
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId } from '../../../utils/tenantUtils';
import {
  getUserIdFromCognitoEvent,
  getUserEmailFromCognitoEvent,
} from '../../../utils/cognitoUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Subscription,
  UserPlanApplication,
} from '../../data-access/repositories/types';
import {
  ok200Response,
  unauthorized401Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

const SERVICE_NAME = process.env.SERVICE_NAME || 'GenU';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || '';
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

/**
 * フロントエンドURL設定
 * FRONTEND_URL: 本番用フロントエンドURL（オプション）
 * ALLOWED_ORIGINS: 許可されたOriginのカンマ区切りリスト（オプション、開発環境用）
 */
const FRONTEND_URL = process.env.FRONTEND_URL || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

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
 * HTMLエスケープ関数
 * ユーザー入力をHTMLに埋め込む際にXSS/HTMLインジェクションを防止
 */
const escapeHtml = (str: string = ''): string => {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (char) => escapeMap[char]);
};

/**
 * データ取得結果の型
 */
type FetchResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error };

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
 *
 * セキュリティ対策：
 * - Originヘッダーは許可リスト（ALLOWED_ORIGINS）に含まれている場合のみ使用
 * - 許可リストに含まれていない場合はFRONTEND_URL（環境変数）を使用
 * - FRONTEND_URLも設定されていない場合は、従来通りOriginヘッダーを使用（後方互換性）
 * - これにより、攻撃者がOriginヘッダーを偽装しても悪意のあるURLにリダイレクトされない
 */
function getBaseUrlFromRequest(event: APIGatewayProxyEvent): string {
  const headers = event.headers;
  const origin = headers['origin'] || headers['Origin'];

  // Originが許可リストに含まれている場合は使用
  if (
    origin &&
    ALLOWED_ORIGINS.length > 0 &&
    ALLOWED_ORIGINS.includes(origin)
  ) {
    return origin;
  }

  // 許可リストにない場合は環境変数のFRONTEND_URLを使用
  if (FRONTEND_URL) {
    return FRONTEND_URL;
  }

  // 後方互換性のため、環境変数が設定されていない場合は従来のロジックを使用
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
 * 保護者向け支払い方法更新リクエストメール作成
 */
const createPaymentMethodUpdateRequestEmail = (
  portalUrl: string,
  childEmail?: string
): { subject: string; htmlContent: string } => {
  const safeChildEmail = escapeHtml(childEmail);

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">お支払い方法の更新のお願い</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      ${childEmail ? `お子様（${safeChildEmail}）の` : 'お子様の'}${SERVICE_NAME}サブスクリプションのお支払い方法を更新するリクエストがありました。<br>
      以下のボタンから、お支払い方法の更新ページにアクセスしてください。
    </p>
    <div style="background-color: ${COLORS.background}; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <p style="margin: 0; color: ${COLORS.text}; font-size: 14px; line-height: 1.6;">
        決済に失敗した場合、サブスクリプションが一時停止される可能性があります。<br>
        お早めにお支払い方法の更新をお願いいたします。
      </p>
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}" style="display: inline-block; background-color: ${COLORS.accent}; color: ${COLORS.white}; text-decoration: none; padding: 16px 48px; border-radius: 6px; font-size: 16px; font-weight: bold;">お支払い方法を更新する</a>
    </div>
    <p style="margin: 24px 0 0 0; color: #666; font-size: 13px; line-height: 1.5;">
      <strong>ご注意:</strong><br>
      • このリンクは有効期限がございます<br>
      • お支払い方法の更新後、サブスクリプションは継続されます<br>
      • 心当たりがない場合は、このメールを無視してください
    </p>
  `;

  const footerNote =
    'このメールは自動送信されています。返信には対応できません。';

  return {
    subject: `【${SERVICE_NAME}】お支払い方法の更新のお願い`,
    htmlContent: createEmailHtml(
      'お支払い方法の更新のお願い',
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

  console.log(`Payment method update request email sent successfully to ${to}`);
};

/**
 * 最も優先度の高いプラン適用を選択する関数
 */
function getApplicationPriority(
  source: UserPlanApplication['application_source']
): number {
  const priorities = {
    subscription: 5,
    manual: 4,
    campaign: 3,
    trial: 2,
    default: 1,
  };
  return priorities[source] || 0;
}

function selectHighestPriorityApplication(
  applications: UserPlanApplication[]
): UserPlanApplication | null {
  if (!applications || applications.length === 0) {
    return null;
  }

  const sorted = [...applications].sort((a, b) => {
    const priorityDiff =
      getApplicationPriority(b.application_source) -
      getApplicationPriority(a.application_source);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return sorted[0];
}

/**
 * ユーザーのプラン適用情報を取得する
 */
async function fetchUserPlanApplications(
  event: APIGatewayProxyEvent,
  userId: string
): Promise<FetchResult<UserPlanApplication[]>> {
  try {
    const data = await invokeDataAccessFunction<UserPlanApplication[]>(
      event,
      'user-plan-application',
      'findActiveByUserId',
      { userId }
    );
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * サブスクリプション情報を取得する
 */
async function fetchSubscription(
  event: APIGatewayProxyEvent,
  subscriptionId: string
): Promise<FetchResult<Subscription | null>> {
  try {
    const data = await invokeDataAccessFunction<Subscription | null>(
      event,
      'subscription',
      'findById',
      { subscriptionId }
    );
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log(
    'User API: Send Payment Method Update Link to Parent request received'
  );

  // 必須環境変数のバリデーション
  if (!SENDGRID_API_KEY) {
    console.error('SENDGRID_API_KEY environment variable is not configured');
    return internalServerError500Response({
      message: 'メール送信の設定が正しく構成されていません',
      code: 'CONFIGURATION_ERROR',
      details: 'SENDGRID_API_KEY is missing',
    });
  }

  if (!SENDGRID_FROM_EMAIL) {
    console.error('SENDGRID_FROM_EMAIL environment variable is not configured');
    return internalServerError500Response({
      message: 'メール送信の設定が正しく構成されていません',
      code: 'CONFIGURATION_ERROR',
      details: 'SENDGRID_FROM_EMAIL is missing',
    });
  }

  try {
    // 1. 認証情報からユーザID、テナントID、子供のメールを取得
    const userId = getUserIdFromCognitoEvent(event);
    const tenantId = getTenantId(event);
    const childEmail = getUserEmailFromCognitoEvent(event);

    if (!userId || !tenantId) {
      console.error('Missing authentication information');
      return unauthorized401Response({
        message: '認証が必要です',
        code: 'UNAUTHORIZED',
        details: undefined,
      });
    }

    console.log('Request context:', { userId, tenantId, childEmail });

    // 2. 現在のプラン適用情報を取得
    const applicationsResult = await fetchUserPlanApplications(event, userId);
    if (!applicationsResult.success) {
      const errorResult = applicationsResult as {
        success: false;
        error: Error;
      };
      console.error(
        'Error fetching user plan applications:',
        errorResult.error
      );
      return internalServerError500Response({
        message: 'プラン情報の取得に失敗しました',
        code: 'DATA_ACCESS_ERROR',
        details: errorResult.error.message,
      });
    }

    const successResult = applicationsResult as {
      success: true;
      data: UserPlanApplication[];
    };
    const applications = successResult.data;

    // 有効なプラン適用をフィルタリング
    const now = new Date();
    const activeApplications = (applications || []).filter((app) => {
      if (
        !['active', 'scheduled_termination'].includes(app.application_status)
      ) {
        return false;
      }
      if (app.valid_until) {
        const validUntil = new Date(app.valid_until);
        if (validUntil < now) {
          return false;
        }
      }
      return true;
    });

    // 最も優先度の高いプラン適用を選択
    const highestPriorityApplication =
      selectHighestPriorityApplication(activeApplications);

    if (!highestPriorityApplication) {
      return notFound404Response({
        message: '現在有効なプランがありません',
        code: 'NO_ACTIVE_PLAN',
        details: undefined,
      });
    }

    // 3. サブスクリプションベースのプランか確認
    if (highestPriorityApplication.application_source !== 'subscription') {
      return notFound404Response({
        message: 'サブスクリプションが見つかりません',
        code: 'NO_SUBSCRIPTION',
        details: undefined,
      });
    }

    if (!highestPriorityApplication.application_source_id) {
      return internalServerError500Response({
        message: 'サブスクリプションIDが見つかりません',
        code: 'MISSING_SUBSCRIPTION_ID',
        details: undefined,
      });
    }

    const subscriptionId = highestPriorityApplication.application_source_id;

    // 4. サブスクリプション情報を取得
    const subscriptionResult = await fetchSubscription(event, subscriptionId);
    if (!subscriptionResult.success) {
      const errorResult = subscriptionResult as {
        success: false;
        error: Error;
      };
      console.error('Error fetching subscription:', errorResult.error);
      return internalServerError500Response({
        message: 'サブスクリプション情報の取得に失敗しました',
        code: 'SUBSCRIPTION_FETCH_ERROR',
        details: errorResult.error.message,
      });
    }
    const subscriptionSuccessResult = subscriptionResult as {
      success: true;
      data: Subscription | null;
    };
    const subscription = subscriptionSuccessResult.data;

    if (!subscription) {
      console.error('Subscription not found:', subscriptionId);
      return notFound404Response({
        message: 'アクティブなサブスクリプションが見つかりません',
        code: 'NO_ACTIVE_SUBSCRIPTION',
        details: undefined,
      });
    }

    // 5. Stripe サブスクリプションIDを確認
    const stripeSubscriptionId = subscription.platform_subscription_id;

    if (!stripeSubscriptionId) {
      console.error('Missing Stripe subscription ID');
      return internalServerError500Response({
        message: 'Stripeサブスクリプション情報が見つかりません',
        code: 'MISSING_STRIPE_INFO',
        details: undefined,
      });
    }

    // 6. Stripe APIキーを取得
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 7. Stripeサブスクリプションから顧客IDと顧客メールアドレスを取得
    const stripeSubscription =
      await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const stripeCustomerId =
      typeof stripeSubscription.customer === 'string'
        ? stripeSubscription.customer
        : stripeSubscription.customer?.id;

    if (!stripeCustomerId) {
      console.error(
        'Customer ID not found in Stripe subscription:',
        stripeSubscriptionId
      );
      return notFound404Response({
        message: '顧客情報が見つかりません',
        code: 'CUSTOMER_NOT_FOUND',
        details: undefined,
      });
    }

    // 8. 顧客情報を取得してメールアドレスを取得
    const customerResponse = await stripe.customers.retrieve(stripeCustomerId);
    if ('deleted' in customerResponse && customerResponse.deleted) {
      console.error('Customer has been deleted:', stripeCustomerId);
      return notFound404Response({
        message: '顧客情報が見つかりません',
        code: 'CUSTOMER_NOT_FOUND',
        details: undefined,
      });
    }

    const customer = customerResponse as Stripe.Customer;
    const parentEmail = customer.email;
    if (!parentEmail) {
      console.error('Customer email not found:', stripeCustomerId);
      return notFound404Response({
        message: '顧客情報が見つかりません',
        code: 'CUSTOMER_NOT_FOUND',
        details: undefined,
      });
    }

    console.log('Customer information retrieved:', {
      customerId: stripeCustomerId,
      parentEmail,
    });

    // 9. return URLを設定
    const baseUrl = getBaseUrlFromRequest(event);
    const returnUrl = `${baseUrl}/billing/parental-payment-update-complete`;

    // 10. Customer Portalセッションを作成
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
      flow_data: {
        type: 'payment_method_update',
        after_completion: {
          type: 'redirect',
          redirect: {
            return_url: returnUrl,
          },
        },
      },
    });

    console.log('Customer Portal session created:', {
      sessionId: portalSession.id,
      url: portalSession.url,
    });

    // 11. 保護者にメール送信
    const emailContent = createPaymentMethodUpdateRequestEmail(
      portalSession.url,
      childEmail
    );

    await sendEmail(
      parentEmail,
      emailContent.subject,
      emailContent.htmlContent
    );

    console.log('Payment method update request email sent:', {
      portalSessionId: portalSession.id,
      parentEmail,
    });

    // 12. レスポンスを返す
    return ok200Response({
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('Error sending payment method update link to parent:', error);

    if (error instanceof Stripe.errors.StripeError) {
      return internalServerError500Response({
        message: 'メール送信に失敗しました',
        code: 'STRIPE_ERROR',
        details: {
          type: error.type,
          code: error.code,
        },
      });
    }

    return internalServerError500Response({
      message: 'メール送信に失敗しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: undefined,
    });
  }
};
