/**
 * Send Plan Change Link to Parent API
 *
 * ペアレンタルコントロール用のプラン変更承認API。
 * 保護者のメールアドレスを受け取り、プラン変更承認リンクをメールで送信します。
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { getTenantId } from '../../../utils/tenantUtils';
import {
  getUserIdFromCognitoEvent,
  getUserEmailFromCognitoEvent,
} from '../../../utils/cognitoUtils';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Plan,
  Subscription,
  UserPlanApplication,
} from '../../data-access/repositories/types';
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
const PENDING_PLAN_CHANGES_TABLE_NAME =
  process.env.PENDING_PLAN_CHANGES_TABLE_NAME || '';

// Expiration time: 24 hours
const EXPIRATION_HOURS = 24;
// TTL: 7 days (for DynamoDB cleanup)
const TTL_DAYS = 7;

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
  success: '#28a745',
  warning: '#ffc107',
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
 * リクエストボディの型（フロントエンドAPI契約）
 */
interface SendPlanChangeLinkRequest {
  /** 変更先のプランID */
  newPlanId: string;
  /** 保護者のメールアドレス */
  parentEmail: string;
}

/**
 * レスポンスボディの型（フロントエンドAPI契約）
 */
interface SendPlanChangeLinkResponse {
  /** メッセージ */
  message: string;
  /** リクエストID */
  requestId: string;
  /** 有効期限（Unix timestamp） */
  expiresAt: number;
}

/**
 * プランレベル定義（アップグレード/ダウングレード判定用）
 */
const PLAN_LEVELS: Record<string, number> = {
  free: 1,
  basic: 2,
  standard: 3,
  premium: 4,
  enterprise: 5,
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
 * DynamoDB Client
 */
const dynamoDbClient = new DynamoDBClient({});

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
 * （決済フローと同様）
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
 * プランレベルを取得
 */
function getPlanLevel(planInternalName: string): number {
  // プラン名からレベルを取得（例: "basic", "premium"など）
  const normalizedName = planInternalName.toLowerCase();
  for (const [key, level] of Object.entries(PLAN_LEVELS)) {
    if (normalizedName.includes(key)) {
      return level;
    }
  }
  return 0; // 不明なプランは最低レベル
}

/**
 * 変更タイプを判定
 */
function determineChangeType(
  currentPlanInternalName: string,
  newPlanInternalName: string
): 'upgrade' | 'downgrade' {
  const currentLevel = getPlanLevel(currentPlanInternalName);
  const newLevel = getPlanLevel(newPlanInternalName);
  return newLevel > currentLevel ? 'upgrade' : 'downgrade';
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
 * プラン比較ブロック（変更前後を表示）
 */
const createPlanComparisonBlock = (
  currentPlanName: string,
  currentPrice: string,
  newPlanName: string,
  newPrice: string,
  changeType: 'upgrade' | 'downgrade',
  childEmail?: string
): string => {
  const safeChildEmail = escapeHtml(childEmail);
  const safeCurrentPlanName = escapeHtml(currentPlanName);
  const safeNewPlanName = escapeHtml(newPlanName);

  const changeTypeLabel =
    changeType === 'upgrade' ? 'アップグレード' : 'ダウングレード';
  const changeTypeColor =
    changeType === 'upgrade' ? COLORS.success : COLORS.warning;

  return `
    <div style="background-color: ${COLORS.background}; border-radius: 8px; padding: 20px; margin: 24px 0;">
      ${
        childEmail
          ? `<div style="margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid ${COLORS.lightGray};">
              <span style="font-size: 14px; color: #666;">お子様のメールアドレス</span><br>
              <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${safeChildEmail}</span>
            </div>`
          : ''
      }
      <div style="display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 16px;">
        <!-- 現在のプラン -->
        <div style="flex: 1; min-width: 180px; text-align: center; padding: 16px; background-color: ${COLORS.white}; border-radius: 8px; border: 1px solid ${COLORS.lightGray};">
          <span style="font-size: 12px; color: #666; display: block; margin-bottom: 8px;">現在のプラン</span>
          <span style="font-size: 18px; font-weight: bold; color: ${COLORS.primary}; display: block;">${safeCurrentPlanName}</span>
          <span style="font-size: 16px; color: ${COLORS.text}; display: block; margin-top: 8px;">${currentPrice}</span>
        </div>
        <!-- 矢印 -->
        <div style="font-size: 24px; color: ${COLORS.accent};">→</div>
        <!-- 変更後のプラン -->
        <div style="flex: 1; min-width: 180px; text-align: center; padding: 16px; background-color: ${COLORS.white}; border-radius: 8px; border: 2px solid ${changeTypeColor};">
          <span style="font-size: 12px; color: #666; display: block; margin-bottom: 8px;">変更後のプラン</span>
          <span style="font-size: 18px; font-weight: bold; color: ${COLORS.primary}; display: block;">${safeNewPlanName}</span>
          <span style="font-size: 16px; color: ${COLORS.accent}; font-weight: bold; display: block; margin-top: 8px;">${newPrice}</span>
        </div>
      </div>
      <div style="text-align: center; margin-top: 16px;">
        <span style="display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 14px; font-weight: bold; background-color: ${changeTypeColor}; color: ${COLORS.white};">${changeTypeLabel}</span>
      </div>
    </div>
  `;
};

/**
 * 請求情報ブロック
 */
const createBillingInfoBlock = (
  nextBillingDate: string,
  nextBillingAmount: string,
  changeType: 'upgrade' | 'downgrade'
): string => {
  const effectNote =
    changeType === 'upgrade'
      ? '承認後、即座に新しいプランが有効になります。'
      : '現在の請求期間終了時に新しいプランに切り替わります。';

  return `
    <div style="background-color: ${COLORS.white}; border: 1px solid ${COLORS.lightGray}; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td style="padding: 8px 0;">
            <span style="font-size: 14px; color: #666;">次回請求日</span><br>
            <span style="font-size: 16px; font-weight: bold; color: ${COLORS.primary};">${nextBillingDate}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-top: 1px solid ${COLORS.lightGray};">
            <span style="font-size: 14px; color: #666;">次回請求額</span><br>
            <span style="font-size: 20px; font-weight: bold; color: ${COLORS.accent};">${nextBillingAmount}</span>
          </td>
        </tr>
      </table>
      <p style="margin: 16px 0 0 0; font-size: 13px; color: #666;">${effectNote}</p>
    </div>
  `;
};

/**
 * 保護者向けプラン変更承認リクエストメール作成
 */
const createPlanChangeApprovalEmail = (
  approvalUrl: string,
  currentPlanName: string,
  currentPrice: string,
  newPlanName: string,
  newPrice: string,
  changeType: 'upgrade' | 'downgrade',
  nextBillingDate: string,
  nextBillingAmount: string,
  childEmail?: string
): { subject: string; htmlContent: string } => {
  const safeChildEmail = escapeHtml(childEmail);

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; color: ${COLORS.primary}; font-size: 20px;">プラン変更の承認リクエスト</h2>
    <p style="margin: 0 0 16px 0; color: ${COLORS.text}; font-size: 15px; line-height: 1.6;">
      ${childEmail ? `お子様（${safeChildEmail}）から` : 'お子様から'}${SERVICE_NAME}のプラン変更リクエストがありました。<br>
      以下の内容をご確認の上、承認してください。
    </p>
    ${createPlanComparisonBlock(currentPlanName, currentPrice, newPlanName, newPrice, changeType, childEmail)}
    ${createBillingInfoBlock(nextBillingDate, nextBillingAmount, changeType)}
    <div style="text-align: center; margin: 24px 0;">
      <a href="${approvalUrl}" style="display: inline-block; background-color: ${COLORS.accent}; color: ${COLORS.white}; text-decoration: none; padding: 16px 48px; border-radius: 6px; font-size: 16px; font-weight: bold;">プラン変更を承認する</a>
    </div>
    <p style="margin: 24px 0 0 0; color: #666; font-size: 13px; line-height: 1.5;">
      <strong>ご注意:</strong><br>
      • このリンクは24時間有効です<br>
      • 承認後、プラン変更が適用されます<br>
      • 心当たりがない場合は、このメールを無視してください
    </p>
  `;

  const footerNote =
    'このメールは自動送信されています。返信には対応できません。';

  return {
    subject: `【${SERVICE_NAME}】プラン変更の承認リクエスト`,
    htmlContent: createEmailHtml(
      'プラン変更の承認リクエスト',
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

  console.log(`Plan change approval email sent successfully to ${to}`);
};

/**
 * 料金フォーマット（JPYのみサポート）
 */
function formatPriceJpy(amount: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
  }).format(amount);
}

/**
 * 日付フォーマット
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

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
 * リクエストボディをパースする
 */
function parseRequestBody(body: string): SendPlanChangeLinkRequest | null {
  try {
    return JSON.parse(body) as SendPlanChangeLinkRequest;
  } catch {
    return null;
  }
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
 * プラン情報を取得する
 */
async function fetchPlan(
  event: APIGatewayProxyEvent,
  planId: string
): Promise<FetchResult<Plan | null>> {
  try {
    const data = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: planId }
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
  console.log('User API: Send Plan Change Link to Parent request received');

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

    // 2. リクエストボディを取得
    if (!event.body) {
      return badRequest400Response({
        message: 'リクエストボディが必要です',
        code: 'MISSING_BODY',
      });
    }

    const requestBody = parseRequestBody(event.body);
    if (!requestBody) {
      return badRequest400Response({
        message: 'リクエストボディが不正なJSON形式です',
        code: 'INVALID_JSON',
      });
    }

    const { newPlanId, parentEmail } = requestBody;

    // 3. 必須パラメータのバリデーション
    if (!newPlanId) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'newPlanId',
          reason: 'newPlanIdは必須です',
        },
      });
    }

    if (!parentEmail) {
      return badRequest400Response({
        message: '必須パラメータが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'parentEmail',
          reason: 'parentEmailは必須です',
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

    // 4. 現在のプラン適用情報を取得
    const applicationsResult = await fetchUserPlanApplications(event, userId);
    if (!applicationsResult.success) {
      console.error(
        'Error fetching user plan applications:',
        applicationsResult.error
      );
      return internalServerError500Response({
        message: 'プラン情報の取得に失敗しました',
        code: 'DATA_ACCESS_ERROR',
        details: applicationsResult.error.message,
      });
    }

    const applications = applicationsResult.data;

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
      });
    }

    const currentPlanId = highestPriorityApplication.plan_id;

    // 5. 同じプランへの変更をチェック
    if (currentPlanId === newPlanId) {
      return badRequest400Response({
        message: '同じプランへの変更はできません',
        code: 'SAME_PLAN',
        details: {
          currentPlanId,
          newPlanId,
        },
      });
    }

    // 6. サブスクリプションベースのプランか確認し、サブスクリプションIDを取得
    if (highestPriorityApplication.application_source !== 'subscription') {
      return badRequest400Response({
        message: 'サブスクリプションベースのプランのみ変更可能です',
        code: 'NOT_SUBSCRIPTION_PLAN',
        details: {
          applicationSource: highestPriorityApplication.application_source,
        },
      });
    }

    if (!highestPriorityApplication.application_source_id) {
      return internalServerError500Response({
        message: 'サブスクリプションIDが見つかりません',
        code: 'MISSING_SUBSCRIPTION_ID',
      });
    }

    const subscriptionId = highestPriorityApplication.application_source_id;

    console.log('Processing plan change request:', {
      newPlanId,
      subscriptionId,
      parentEmail,
    });

    // 7. 現在のプラン情報を取得
    const currentPlanResult = await fetchPlan(event, currentPlanId);
    if (!currentPlanResult.success) {
      console.error('Error fetching current plan:', currentPlanResult.error);
      return internalServerError500Response({
        message: '現在のプラン情報の取得に失敗しました',
        code: 'PLAN_FETCH_ERROR',
        details: currentPlanResult.error.message,
      });
    }
    const currentPlan = currentPlanResult.data;

    if (!currentPlan) {
      console.error('Current plan not found:', currentPlanId);
      return notFound404Response({
        message: '現在のプランが見つかりません',
        code: 'CURRENT_PLAN_NOT_FOUND',
        details: { planId: currentPlanId },
      });
    }

    // 8. 新しいプラン情報を取得
    const newPlanResult = await fetchPlan(event, newPlanId);
    if (!newPlanResult.success) {
      console.error('Error fetching new plan:', newPlanResult.error);
      return internalServerError500Response({
        message: '新しいプラン情報の取得に失敗しました',
        code: 'PLAN_FETCH_ERROR',
        details: newPlanResult.error.message,
      });
    }
    const newPlan = newPlanResult.data;

    if (!newPlan) {
      console.error('New plan not found:', newPlanId);
      return badRequest400Response({
        message: '指定されたプランが見つかりません',
        code: 'INVALID_PLAN',
        details: { planId: newPlanId },
      });
    }

    // 9. プランのステータスを確認
    if (newPlan.status === 'deprecated') {
      console.error('Plan is deprecated:', newPlanId);
      return badRequest400Response({
        message: 'このプランは廃止されており、変更できません',
        code: 'PLAN_DEPRECATED',
        details: { planId: newPlanId },
      });
    }

    // 10. サブスクリプション情報を取得
    const subscriptionResult = await fetchSubscription(event, subscriptionId);
    if (!subscriptionResult.success) {
      console.error('Error fetching subscription:', subscriptionResult.error);
      return internalServerError500Response({
        message: 'サブスクリプション情報の取得に失敗しました',
        code: 'SUBSCRIPTION_FETCH_ERROR',
        details: subscriptionResult.error.message,
      });
    }
    const subscription = subscriptionResult.data;

    if (!subscription) {
      console.error('Subscription not found:', subscriptionId);
      return notFound404Response({
        message: 'アクティブなサブスクリプションが見つかりません',
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
    }

    // 11. Stripe APIキーを取得して価格情報を取得
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    // 現在のプラン価格
    let currentPriceAmount = 0;
    if (currentPlan.platform_product_id) {
      const currentPrice = await stripe.prices.retrieve(
        currentPlan.platform_product_id
      );
      currentPriceAmount = currentPrice.unit_amount || 0;
    }

    // 新しいプラン価格
    let newPriceAmount = 0;
    if (newPlan.platform_product_id) {
      const newPrice = await stripe.prices.retrieve(
        newPlan.platform_product_id
      );
      newPriceAmount = newPrice.unit_amount || 0;
    }

    const formattedCurrentPrice = formatPriceJpy(currentPriceAmount);
    const formattedNewPrice = formatPriceJpy(newPriceAmount);

    // 12. アップグレード/ダウングレード判定
    const changeType = determineChangeType(
      currentPlan.internal_name,
      newPlan.internal_name
    );

    // 13. 次回請求日を計算
    const nextBillingDate = new Date(subscription.current_period_end);
    const formattedNextBillingDate = formatDate(nextBillingDate);
    const formattedNextBillingAmount = formatPriceJpy(newPriceAmount);

    // 14. Stripe サブスクリプションIDを確認
    const stripeSubscriptionId = subscription.platform_subscription_id;

    if (!stripeSubscriptionId) {
      console.error('Missing Stripe subscription ID');
      return internalServerError500Response({
        message: 'Stripeサブスクリプション情報が見つかりません',
        code: 'MISSING_STRIPE_INFO',
      });
    }

    // 15. Stripeサブスクリプションから customer ID と subscription item ID を取得
    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const subscriptionItemId = stripeSubscription.items.data[0]?.id;
    const currentStripePriceId =
      typeof stripeSubscription.items.data[0]?.price === 'string'
        ? stripeSubscription.items.data[0]?.price
        : stripeSubscription.items.data[0]?.price?.id;
    const stripeCustomerId =
      typeof stripeSubscription.customer === 'string'
        ? stripeSubscription.customer
        : stripeSubscription.customer?.id;

    if (!subscriptionItemId) {
      console.error('Subscription item not found:', stripeSubscriptionId);
      return internalServerError500Response({
        message: 'サブスクリプションアイテムが見つかりません',
        code: 'SUBSCRIPTION_ITEM_NOT_FOUND',
      });
    }

    if (!stripeCustomerId) {
      console.error('Customer ID not found in Stripe subscription:', stripeSubscriptionId);
      return internalServerError500Response({
        message: 'Stripe顧客情報が見つかりません',
        code: 'MISSING_STRIPE_CUSTOMER',
      });
    }

    // 15.5. サブスクリプションのメタデータに変更前のプラン情報を保存
    // これにより、webhookで previous_attributes.items がない場合でもプラン変更を検出可能
    // userId を必ず含めることで、webhook処理で子供のユーザーIDを正しく取得できる
    await stripe.subscriptions.update(stripeSubscriptionId, {
      metadata: {
        ...stripeSubscription.metadata,
        userId, // 子供のユーザーID（Cognito認証から取得）- webhook処理で必須
        pendingPlanChange: 'true',
        originalPriceId: currentStripePriceId || '',
        targetPriceId: newPlan.platform_product_id || '',
        parentalControlRequest: 'true',
      },
    });

    console.log('Subscription metadata updated for plan change tracking:', {
      subscriptionId: stripeSubscriptionId,
      userId,
      originalPriceId: currentStripePriceId,
      targetPriceId: newPlan.platform_product_id,
    });

    // 16. return URLを設定（決済フローと同様、フロントエンドのURL）
    const baseUrl = getBaseUrlFromRequest(event);
    const returnUrl = `${baseUrl}/billing/parental-complete`;

    // 17. Customer Portalセッションを作成（Deep Link: subscription_update_confirm）
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
      flow_data: {
        type: 'subscription_update_confirm',
        after_completion: {
          type: 'redirect',
          redirect: {
            return_url: returnUrl,
          },
        },
        subscription_update_confirm: {
          subscription: stripeSubscriptionId,
          items: [
            {
              id: subscriptionItemId,
              price: newPlan.platform_product_id!,
            },
          ],
        },
      },
    });

    console.log('Customer Portal session created:', {
      sessionId: portalSession.id,
      url: portalSession.url,
    });

    // 18. DynamoDBに履歴を保存（オプション）
    const requestId = randomUUID();
    const nowTimestamp = Date.now();
    const expiresAt = nowTimestamp + EXPIRATION_HOURS * 60 * 60 * 1000;
    const ttl = Math.floor(
      (nowTimestamp + TTL_DAYS * 24 * 60 * 60 * 1000) / 1000
    );

    await dynamoDbClient.send(
      new PutItemCommand({
        TableName: PENDING_PLAN_CHANGES_TABLE_NAME,
        Item: {
          requestId: { S: requestId },
          portalSessionId: { S: portalSession.id },
          tenantId: { S: tenantId },
          userId: { S: userId },
          subscriptionId: { S: subscriptionId },
          currentPlanId: { S: currentPlanId },
          newPlanId: { S: newPlanId },
          parentEmail: { S: parentEmail },
          childEmail: { S: childEmail || '' },
          changeType: { S: changeType },
          status: { S: 'pending' },
          createdAt: { N: nowTimestamp.toString() },
          expiresAt: { N: expiresAt.toString() },
          ttl: { N: ttl.toString() },
        },
      })
    );

    console.log('Pending plan change request saved:', {
      requestId,
      portalSessionId: portalSession.id,
    });

    // 19. 保護者にメール送信（Stripe Portal URLを直接含める）
    const emailContent = createPlanChangeApprovalEmail(
      portalSession.url,
      currentPlan.display_name,
      formattedCurrentPrice,
      newPlan.display_name,
      formattedNewPrice,
      changeType,
      formattedNextBillingDate,
      formattedNextBillingAmount,
      childEmail
    );

    await sendEmail(
      parentEmail,
      emailContent.subject,
      emailContent.htmlContent
    );

    console.log('Plan change approval email sent:', {
      requestId,
      parentEmail,
      portalSessionId: portalSession.id,
    });

    // 20. レスポンスを返す
    return ok200Response({
      message: 'プラン変更の承認リンクを保護者のメールアドレスに送信しました',
      requestId,
      expiresAt: Math.floor(expiresAt / 1000),
    });
  } catch (error) {
    console.error('Error sending plan change link to parent:', error);

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
