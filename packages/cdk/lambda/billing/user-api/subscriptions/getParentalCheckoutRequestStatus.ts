/**
 * Get Parental Checkout Request Status API
 *
 * 保留中のペアレンタルコントロール新規購入リクエストのステータスを取得するAPI。
 * フロントエンドが保護者の決済完了をポーリングで検知するために使用します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { getTenantId } from '../../../utils/tenantUtils';
import { getUserIdFromCognitoEvent } from '../../../utils/cognitoUtils';
import {
  ok200Response,
  badRequest400Response,
  unauthorized401Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

const PENDING_PARENTAL_CHECKOUTS_TABLE_NAME =
  process.env.PENDING_PARENTAL_CHECKOUTS_TABLE_NAME || '';

/**
 * レスポンスボディの型（フロントエンドAPI契約）
 */
interface ParentalCheckoutRequestStatusResponse {
  /** リクエストID */
  requestId: string;
  /** ステータス */
  status: 'pending' | 'approved' | 'expired';
  /** プランID */
  planId: string;
  /** 保護者のメールアドレス */
  parentEmail: string;
  /** 作成日時（Unix timestamp） */
  createdAt: number;
  /** 有効期限（Unix timestamp） */
  expiresAt: number;
  /** 承認日時（Unix timestamp、承認済みの場合のみ） */
  approvedAt?: number;
  /** サブスクリプションID（承認済みの場合のみ） */
  subscriptionId?: string;
}

/**
 * DynamoDB Client
 */
const dynamoDbClient = new DynamoDBClient({});

/**
 * Lambda関数のメインハンドラー
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log(
    'User API: Get Parental Checkout Request Status request received'
  );

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

    // 2. パスパラメータからrequestIdを取得
    const requestId = event.pathParameters?.requestId;

    if (!requestId) {
      return badRequest400Response({
        message: 'リクエストIDが指定されていません',
        code: 'MISSING_REQUEST_ID',
      });
    }

    console.log('Fetching parental checkout request status:', { requestId });

    // 3. DynamoDBから保留リクエストを取得
    const result = await dynamoDbClient.send(
      new GetItemCommand({
        TableName: PENDING_PARENTAL_CHECKOUTS_TABLE_NAME,
        Key: {
          requestId: { S: requestId },
        },
      })
    );

    if (!result.Item) {
      console.error('Parental checkout request not found:', requestId);
      return notFound404Response({
        message: '購入リクエストが見つかりません',
        code: 'REQUEST_NOT_FOUND',
        details: { requestId },
      });
    }

    const item = result.Item;

    // 4. ユーザーIDとテナントIDを検証（自分のリクエストのみ取得可能）
    const requestUserId = item.userId?.S;
    const requestTenantId = item.tenantId?.S;

    if (requestUserId !== userId || requestTenantId !== tenantId) {
      console.error('Unauthorized access to parental checkout request:', {
        requestId,
        requestUserId,
        requestTenantId,
        userId,
        tenantId,
      });
      return notFound404Response({
        message: '購入リクエストが見つかりません',
        code: 'REQUEST_NOT_FOUND',
        details: { requestId },
      });
    }

    // 5. ステータスを確認し、期限切れの場合は更新
    let status = (item.status?.S as 'pending' | 'approved' | 'expired') ||
      'pending';
    const expiresAt = Number(item.expiresAt?.N || 0);
    const now = Date.now();

    if (status === 'pending' && now > expiresAt) {
      // 期限切れの場合、ステータスをDynamoDBに永続化
      status = 'expired';
      console.log('Parental checkout request expired, updating status:', {
        requestId,
        expiresAt,
        now,
      });

      // 非同期でステータスを更新（レスポンスをブロックしない）
      dynamoDbClient
        .send(
          new UpdateItemCommand({
            TableName: PENDING_PARENTAL_CHECKOUTS_TABLE_NAME,
            Key: {
              requestId: { S: requestId },
            },
            UpdateExpression: 'SET #status = :status, expiredAt = :expiredAt',
            ConditionExpression: '#status = :pendingStatus',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':status': { S: 'expired' },
              ':expiredAt': { N: now.toString() },
              ':pendingStatus': { S: 'pending' },
            },
          })
        )
        .then(() => {
          console.log('Parental checkout request status updated to expired:', {
            requestId,
          });
        })
        .catch((err) => {
          // 条件チェック失敗（既に更新済み）の場合は無視
          if (err.name !== 'ConditionalCheckFailedException') {
            console.error('Failed to update expired status:', err);
          }
        });
    }

    // 6. レスポンスを構築
    const response: ParentalCheckoutRequestStatusResponse = {
      requestId: item.requestId?.S || '',
      status,
      planId: item.planId?.S || '',
      parentEmail: item.parentEmail?.S || '',
      createdAt: Number(item.createdAt?.N || 0),
      expiresAt,
    };

    // 承認済みの場合、追加情報を含める
    if (status === 'approved') {
      if (item.approvedAt?.N) {
        response.approvedAt = Number(item.approvedAt.N);
      }
      if (item.subscriptionId?.S) {
        response.subscriptionId = item.subscriptionId.S;
      }
    }

    console.log('Parental checkout request status retrieved:', {
      requestId,
      status: response.status,
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Error getting parental checkout request status:', error);

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: undefined,
    });
  }
};
