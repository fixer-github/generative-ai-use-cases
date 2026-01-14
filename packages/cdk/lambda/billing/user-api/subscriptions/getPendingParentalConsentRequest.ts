/**
 * Get Pending Parental Consent Request API
 *
 * 現在のユーザーの保護者同意待ちリクエストを取得するAPI。
 * 新規購入・プラン変更の両方に対応し、重複購入を防止するために使用します。
 *
 * Stripe Checkout Sessionの状態を確認し、決済完了済みの場合は204を返します。
 */

import Stripe from 'stripe';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';
import {
  ok200Response,
  unauthorized401Response,
  noContent204Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

const PENDING_PLAN_CHANGES_TABLE_NAME =
  process.env.PENDING_PLAN_CHANGES_TABLE_NAME || '';
const PENDING_PARENTAL_CHECKOUTS_TABLE_NAME =
  process.env.PENDING_PARENTAL_CHECKOUTS_TABLE_NAME || '';

/**
 * レスポンスボディの型（フロントエンドAPI契約）
 */
interface PendingParentalConsentResponse {
  /** リクエストID */
  requestId: string;
  /** ステータス */
  status: 'pending' | 'approved' | 'expired';
  /** リクエストの種類 */
  type: 'purchase' | 'change';
  /** 保護者のメールアドレス */
  parentEmail: string;
  /** 購入/変更先のプランID */
  planId: string;
  /** 作成日時（Unix timestamp ミリ秒） */
  createdAt: number;
  /** 有効期限（Unix timestamp ミリ秒） */
  expiresAt: number;
  /** 承認日時（Unix timestamp ミリ秒、承認済みの場合のみ） */
  approvedAt?: number;

  // 購入モード (type === 'purchase') の場合
  /** Stripe Checkout Session ID */
  sessionId?: string;
  /** サブスクリプションID（承認後に付与） */
  subscriptionId?: string;

  // 変更モード (type === 'change') の場合
  /** 現在のプランID */
  currentPlanId?: string;
  /** 変更タイプ */
  changeType?: 'upgrade' | 'downgrade';
  /** 変更適用日 (ダウングレードの場合) */
  effectiveDate?: string;
}

/**
 * DynamoDB Client
 */
const dynamoDbClient = new DynamoDBClient({});

/**
 * Secrets Manager Client
 */
const secretsManagerClient = new SecretsManagerClient({});

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
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await secretsManagerClient.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretName} is empty`);
  }

  const secret = JSON.parse(response.SecretString);
  stripeApiKeyCache[tenantId] = secret.apiKey;

  return secret.apiKey;
}

/**
 * Stripe Checkout Sessionの決済完了状態を確認
 * @returns true: 決済完了, false: 未完了
 */
async function isCheckoutSessionCompleted(
  tenantId: string,
  sessionId: string
): Promise<boolean> {
  try {
    const apiKey = await getStripeApiKey(tenantId);
    const stripe = new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session.status === 'complete';
  } catch (error) {
    console.error('Error checking Stripe checkout session:', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    // エラー時はfalseを返し、pendingとして扱う
    return false;
  }
}

/**
 * DynamoDBのリクエストステータスをapprovedに更新（非同期）
 */
async function updateRequestStatusToApproved(
  tableName: string,
  requestId: string
): Promise<void> {
  try {
    await dynamoDbClient.send(
      new UpdateItemCommand({
        TableName: tableName,
        Key: {
          requestId: { S: requestId },
        },
        UpdateExpression: 'SET #status = :status, approvedAt = :approvedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': { S: 'approved' },
          ':approvedAt': { N: Date.now().toString() },
        },
      })
    );

    console.log('Updated parental checkout request status to approved:', {
      requestId,
    });
  } catch (error) {
    // 更新失敗はログのみ（レスポンスには影響させない）
    console.error('Error updating request status to approved:', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * DynamoDBアイテムからpurchaseタイプのレスポンスを構築
 */
const buildPurchaseResponse = (
  item: Record<string, { S?: string; N?: string }>
): PendingParentalConsentResponse => {
  const response: PendingParentalConsentResponse = {
    requestId: item.requestId?.S || '',
    status: (item.status?.S as 'pending' | 'approved' | 'expired') || 'pending',
    type: 'purchase',
    parentEmail: item.parentEmail?.S || '',
    planId: item.planId?.S || '',
    createdAt: Number(item.createdAt?.N || 0),
    expiresAt: Number(item.expiresAt?.N || 0),
    sessionId: item.checkoutSessionId?.S,
  };

  if (response.status === 'approved') {
    if (item.approvedAt?.N) {
      response.approvedAt = Number(item.approvedAt.N);
    }
    if (item.subscriptionId?.S) {
      response.subscriptionId = item.subscriptionId.S;
    }
  }

  return response;
};

/**
 * DynamoDBアイテムからchangeタイプのレスポンスを構築
 */
const buildChangeResponse = (
  item: Record<string, { S?: string; N?: string }>
): PendingParentalConsentResponse => {
  const response: PendingParentalConsentResponse = {
    requestId: item.requestId?.S || '',
    status: (item.status?.S as 'pending' | 'approved' | 'expired') || 'pending',
    type: 'change',
    parentEmail: item.parentEmail?.S || '',
    planId: item.newPlanId?.S || '', // changeの場合はnewPlanId
    createdAt: Number(item.createdAt?.N || 0),
    expiresAt: Number(item.expiresAt?.N || 0),
    currentPlanId: item.currentPlanId?.S,
    changeType: item.changeType?.S as 'upgrade' | 'downgrade' | undefined,
  };

  if (response.status === 'approved') {
    if (item.approvedAt?.N) {
      response.approvedAt = Number(item.approvedAt.N);
    }
  }

  // effectiveDateがあれば追加
  if (item.effectiveDate?.S) {
    response.effectiveDate = item.effectiveDate.S;
  }

  return response;
};

/**
 * ステータスを確認し、期限切れの場合は'expired'を返す
 */
const checkExpiredStatus = (
  status: string,
  expiresAt: number
): 'pending' | 'approved' | 'expired' => {
  if (status === 'pending' && Date.now() > expiresAt) {
    return 'expired';
  }
  return status as 'pending' | 'approved' | 'expired';
};

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('User API: Get Pending Parental Consent Request received');

  try {
    // 1. 認証情報からユーザID、テナントIDを取得
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

    // 2. 両方のテーブルから最新のリクエストを検索（statusフィルターなし、Limit外して全件取得）
    // NOTE: DynamoDBのFilterExpressionはLimit適用後に評価されるため、Limitを外して
    // 全件取得し、コード側でpendingを探す必要がある
    const [purchaseResult, changeResult] = await Promise.all([
      // 新規購入テーブルを検索（最新順）
      PENDING_PARENTAL_CHECKOUTS_TABLE_NAME
        ? dynamoDbClient.send(
            new QueryCommand({
              TableName: PENDING_PARENTAL_CHECKOUTS_TABLE_NAME,
              IndexName: 'userId-index',
              KeyConditionExpression: 'userId = :userId',
              FilterExpression: 'tenantId = :tenantId',
              ExpressionAttributeValues: {
                ':userId': { S: userId },
                ':tenantId': { S: tenantId },
              },
              ScanIndexForward: false, // 降順（最新が最初）
            })
          )
        : Promise.resolve({ Items: [] }),

      // プラン変更テーブルを検索（最新順）
      PENDING_PLAN_CHANGES_TABLE_NAME
        ? dynamoDbClient.send(
            new QueryCommand({
              TableName: PENDING_PLAN_CHANGES_TABLE_NAME,
              IndexName: 'userId-index',
              KeyConditionExpression: 'userId = :userId',
              FilterExpression: 'tenantId = :tenantId',
              ExpressionAttributeValues: {
                ':userId': { S: userId },
                ':tenantId': { S: tenantId },
              },
              ScanIndexForward: false, // 降順（最新が最初）
            })
          )
        : Promise.resolve({ Items: [] }),
    ]);

    // 3. 結果を処理
    const purchaseItems = purchaseResult.Items || [];
    const changeItems = changeResult.Items || [];

    console.log('Query results:', {
      purchaseCount: purchaseItems.length,
      changeCount: changeItems.length,
    });

    // 全件の中から最新のpendingを探す（期限切れでないもの）
    // DynamoDBは降順ソートされているので、最初に見つかったpendingが最新

    // 購入リクエストからpendingを探す
    for (const item of purchaseItems as Record<
      string,
      { S?: string; N?: string }
    >[]) {
      const response = buildPurchaseResponse(item);

      // 期限切れチェック
      response.status = checkExpiredStatus(response.status, response.expiresAt);

      // pendingでなければスキップ（次のレコードを確認）
      if (response.status !== 'pending') {
        continue;
      }

      // ステータスが pending の場合、Stripe Checkout Session の状態を確認
      if (response.sessionId) {
        const isCompleted = await isCheckoutSessionCompleted(
          tenantId,
          response.sessionId
        );

        if (isCompleted) {
          console.log(
            'Stripe checkout is complete, updating DynamoDB and returning 204:',
            {
              requestId: response.requestId,
              sessionId: response.sessionId,
            }
          );

          // DynamoDBのステータスを非同期で更新（awaitしない）
          updateRequestStatusToApproved(
            PENDING_PARENTAL_CHECKOUTS_TABLE_NAME,
            response.requestId
          ).catch((err) => {
            console.error('Background DynamoDB update failed:', err);
          });

          return noContent204Response();
        }
      }

      // Stripe未完了のpendingが見つかった
      console.log('Pending purchase request found:', {
        requestId: response.requestId,
        planId: response.planId,
      });

      return ok200Response(response);
    }

    // プラン変更リクエストからpendingを探す
    for (const item of changeItems as Record<
      string,
      { S?: string; N?: string }
    >[]) {
      const response = buildChangeResponse(item);

      // 期限切れチェック
      response.status = checkExpiredStatus(response.status, response.expiresAt);

      // pendingでなければスキップ（次のレコードを確認）
      if (response.status !== 'pending') {
        continue;
      }

      // ステータスが pending の場合、Checkout Session があれば Stripe の状態を確認
      const sessionId = item.checkoutSessionId?.S;
      if (sessionId) {
        const isCompleted = await isCheckoutSessionCompleted(
          tenantId,
          sessionId
        );

        if (isCompleted) {
          console.log(
            'Stripe checkout is complete, updating DynamoDB and returning 204:',
            {
              requestId: response.requestId,
              sessionId,
            }
          );

          // DynamoDBのステータスを非同期で更新（awaitしない）
          updateRequestStatusToApproved(
            PENDING_PLAN_CHANGES_TABLE_NAME,
            response.requestId
          ).catch((err) => {
            console.error('Background DynamoDB update failed:', err);
          });

          return noContent204Response();
        }
      }

      // Stripe未完了のpendingが見つかった
      console.log('Pending change request found:', {
        requestId: response.requestId,
        planId: response.planId,
        currentPlanId: response.currentPlanId,
        changeType: response.changeType,
      });

      return ok200Response(response);
    }

    // 4. 保留中のリクエストが見つからない場合は 204 No Content を返す
    console.log('No parental consent request found for user:', userId);

    return noContent204Response();
  } catch (error) {
    console.error('Error getting pending parental consent request:', error);

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: undefined,
    });
  }
};
