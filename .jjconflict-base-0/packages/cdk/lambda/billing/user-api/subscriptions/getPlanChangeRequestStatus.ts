/**
 * Get Plan Change Request Status API
 *
 * 保留中のプラン変更リクエストのステータスを取得するAPI。
 * フロントエンドが保護者の承認完了をポーリングで検知するために使用します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
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

const PENDING_PLAN_CHANGES_TABLE_NAME = process.env.PENDING_PLAN_CHANGES_TABLE_NAME || '';

/**
 * レスポンスボディの型（フロントエンドAPI契約）
 */
interface PlanChangeRequestStatusResponse {
  /** リクエストID */
  requestId: string;
  /** ステータス */
  status: 'pending' | 'approved' | 'expired';
  /** 変更タイプ */
  changeType: 'upgrade' | 'downgrade';
  /** 新しいプランID */
  newPlanId: string;
  /** 現在のプランID */
  currentPlanId: string;
  /** 作成日時（Unix timestamp） */
  createdAt: number;
  /** 有効期限（Unix timestamp） */
  expiresAt: number;
  /** 承認日時（Unix timestamp、承認済みの場合のみ） */
  approvedAt?: number;
  /** 有効日時（承認済みの場合のみ） */
  effectiveDate?: string;
  /** フロー実行ID（承認済みの場合のみ） */
  flowExecutionId?: string;
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
  console.log('User API: Get Plan Change Request Status request received');

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

    console.log('Fetching plan change request status:', { requestId });

    // 3. DynamoDBから保留リクエストを取得
    const result = await dynamoDbClient.send(
      new GetItemCommand({
        TableName: PENDING_PLAN_CHANGES_TABLE_NAME,
        Key: {
          requestId: { S: requestId },
        },
      })
    );

    if (!result.Item) {
      console.error('Plan change request not found:', requestId);
      return notFound404Response({
        message: 'プラン変更リクエストが見つかりません',
        code: 'REQUEST_NOT_FOUND',
        details: { requestId },
      });
    }

    const item = result.Item;

    // 4. ユーザーIDとテナントIDを検証（自分のリクエストのみ取得可能）
    const requestUserId = item.userId?.S;
    const requestTenantId = item.tenantId?.S;

    if (requestUserId !== userId || requestTenantId !== tenantId) {
      console.error('Unauthorized access to plan change request:', {
        requestId,
        requestUserId,
        requestTenantId,
        userId,
        tenantId,
      });
      return notFound404Response({
        message: 'プラン変更リクエストが見つかりません',
        code: 'REQUEST_NOT_FOUND',
        details: { requestId },
      });
    }

    // 5. ステータスを確認し、期限切れの場合は更新
    let status = (item.status?.S as 'pending' | 'approved' | 'expired') || 'pending';
    const expiresAt = Number(item.expiresAt?.N || 0);
    const now = Date.now();

    if (status === 'pending' && now > expiresAt) {
      // 期限切れの場合、ステータスを更新（次回のクリーンアップで処理される）
      status = 'expired';
      console.log('Plan change request expired:', { requestId, expiresAt, now });
    }

    // 6. レスポンスを構築
    const response: PlanChangeRequestStatusResponse = {
      requestId: item.requestId?.S || '',
      status,
      changeType: (item.changeType?.S as 'upgrade' | 'downgrade') || 'upgrade',
      newPlanId: item.newPlanId?.S || '',
      currentPlanId: item.currentPlanId?.S || '',
      createdAt: Number(item.createdAt?.N || 0),
      expiresAt,
    };

    // 承認済みの場合、追加情報を含める
    if (status === 'approved') {
      if (item.approvedAt?.N) {
        response.approvedAt = Number(item.approvedAt.N);
      }
      if (item.effectiveDate?.S) {
        response.effectiveDate = item.effectiveDate.S;
      }
      if (item.flowExecutionId?.S) {
        response.flowExecutionId = item.flowExecutionId.S;
      }
    }

    console.log('Plan change request status retrieved:', {
      requestId,
      status: response.status,
    });

    return ok200Response(response);
  } catch (error) {
    console.error('Error getting plan change request status:', error);

    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: undefined,
    });
  }
};
