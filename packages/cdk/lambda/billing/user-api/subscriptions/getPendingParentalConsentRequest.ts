/**
 * Get Pending Parental Consent Request API
 *
 * 現在のユーザーの保護者同意待ちリクエストを取得するAPI。
 * 新規購入・プラン変更の両方に対応し、重複購入を防止するために使用します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';
import {
  ok200Response,
  unauthorized401Response,
  notFound404Response,
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

    // 2. 両方のテーブルからpendingリクエストを検索
    const [purchaseResult, changeResult] = await Promise.all([
      // 新規購入テーブルを検索
      PENDING_PARENTAL_CHECKOUTS_TABLE_NAME
        ? dynamoDbClient.send(
            new QueryCommand({
              TableName: PENDING_PARENTAL_CHECKOUTS_TABLE_NAME,
              IndexName: 'userId-index',
              KeyConditionExpression: 'userId = :userId',
              FilterExpression: 'tenantId = :tenantId AND #status = :status',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':userId': { S: userId },
                ':tenantId': { S: tenantId },
                ':status': { S: 'pending' },
              },
              Limit: 1,
            })
          )
        : Promise.resolve({ Items: [] }),

      // プラン変更テーブルを検索
      PENDING_PLAN_CHANGES_TABLE_NAME
        ? dynamoDbClient.send(
            new QueryCommand({
              TableName: PENDING_PLAN_CHANGES_TABLE_NAME,
              IndexName: 'userId-index',
              KeyConditionExpression: 'userId = :userId',
              FilterExpression: 'tenantId = :tenantId AND #status = :status',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':userId': { S: userId },
                ':tenantId': { S: tenantId },
                ':status': { S: 'pending' },
              },
              Limit: 1,
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

    // 購入リクエストが見つかった場合
    if (purchaseItems.length > 0) {
      const item = purchaseItems[0] as Record<string, { S?: string; N?: string }>;
      const response = buildPurchaseResponse(item);

      // 期限切れチェック
      response.status = checkExpiredStatus(response.status, response.expiresAt);

      // pending以外（期限切れ含む）は404を返す
      if (response.status !== 'pending') {
        console.log('Purchase request is not pending (expired or approved):', {
          requestId: response.requestId,
          status: response.status,
        });
        return notFound404Response({
          message: '保留中のリクエストはありません',
          code: 'NO_PENDING_REQUEST',
          details: undefined,
        });
      }

      console.log('Pending purchase request found:', {
        requestId: response.requestId,
        planId: response.planId,
      });

      return ok200Response(response);
    }

    // プラン変更リクエストが見つかった場合
    if (changeItems.length > 0) {
      const item = changeItems[0] as Record<string, { S?: string; N?: string }>;
      const response = buildChangeResponse(item);

      // 期限切れチェック
      response.status = checkExpiredStatus(response.status, response.expiresAt);

      // pending以外（期限切れ含む）は404を返す
      if (response.status !== 'pending') {
        console.log('Change request is not pending (expired or approved):', {
          requestId: response.requestId,
          status: response.status,
        });
        return notFound404Response({
          message: '保留中のリクエストはありません',
          code: 'NO_PENDING_REQUEST',
          details: undefined,
        });
      }

      console.log('Pending change request found:', {
        requestId: response.requestId,
        planId: response.planId,
        currentPlanId: response.currentPlanId,
        changeType: response.changeType,
      });

      return ok200Response(response);
    }

    // 4. 保留中のリクエストが見つからない場合
    console.log('No pending parental consent request found for user:', userId);

    return notFound404Response({
      message: '保留中のリクエストはありません',
      code: 'NO_PENDING_REQUEST',
      details: undefined,
    });
  } catch (error) {
    console.error('Error getting pending parental consent request:', error);

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: undefined,
    });
  }
};
