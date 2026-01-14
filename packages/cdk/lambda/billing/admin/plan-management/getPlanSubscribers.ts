/**
 * プラン加入者一覧取得API
 * GET /admin/billing/plans/{plan_id}/subscribers
 *
 * 指定されたプランの加入者一覧を取得します。
 * ページネーション、メールアドレス取得（Cognito経由）をサポートします。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  verifyAdminAccess,
  isAdminContext,
  getAttributeValue,
} from '../../../utils/adminAuth';
import { invokeDataAccessFunction } from '../../utils/dataAccessClient';
import {
  Plan,
  UserPlanApplication,
} from '../../data-access/repositories/types';
import {
  ok200Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION!,
});
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface QueryParams {
  page?: string;
  limit?: string;
}

interface PaginatedResult {
  items: UserPlanApplication[];
  total_count: number;
}

interface SubscriberInfo {
  user_id: string;
  email: string | null;
  application_id: string;
  application_source: string;
  application_status: string;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // 管理者権限の検証
    const adminResult = await verifyAdminAccess(event);
    if (!isAdminContext(adminResult)) {
      return adminResult;
    }

    // パスパラメータからplan_idを取得
    const planId = event.pathParameters?.plan_id;
    if (!planId) {
      return badRequest400Response({
        message: 'プランIDが指定されていません',
        code: 'MISSING_PARAMETER',
        details: {
          field: 'plan_id',
          reason: 'パスパラメータにplan_idを指定してください',
        },
      });
    }

    // クエリパラメータの取得
    const params = (event.queryStringParameters || {}) as QueryParams;
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10)));
    const offset = (page - 1) * limit;

    // プランの存在確認（データアクセス層Lambda関数を呼び出し）
    const plan = await invokeDataAccessFunction<Plan | null>(
      event,
      'plan',
      'findById',
      { id: planId }
    );
    if (!plan) {
      return notFound404Response({
        message: '指定されたプランが見つかりません',
        code: 'PLAN_NOT_FOUND',
        details: {
          plan_id: planId,
        },
      });
    }

    // プラン加入者一覧を取得（ページネーション対応）
    const result = await invokeDataAccessFunction<PaginatedResult>(
      event,
      'user-plan-application',
      'findAllPaginated',
      {
        planId,
        status: ['active', 'scheduled_termination'],
        limit,
        offset,
      }
    );

    // 各ユーザーのメールアドレスをCognitoから取得
    const subscribers: SubscriberInfo[] = await Promise.all(
      result.items.map(async (app) => {
        let email: string | null = null;
        try {
          const command = new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: app.user_id,
          });
          const userResponse = await cognitoClient.send(command);
          email = getAttributeValue(userResponse.UserAttributes, 'email');
        } catch (error) {
          console.warn(`Failed to get email for user ${app.user_id}:`, error);
          // メール取得に失敗してもnullのまま続行
        }

        return {
          user_id: app.user_id,
          email,
          application_id: app.application_id,
          application_source: app.application_source,
          application_status: app.application_status,
          valid_from: new Date(app.valid_from).toISOString(),
          valid_until: app.valid_until
            ? new Date(app.valid_until).toISOString()
            : null,
          created_at: new Date(app.created_at).toISOString(),
        };
      })
    );

    const totalPages = Math.ceil(result.total_count / limit);

    // レスポンスの構築
    const response = {
      plan_id: planId,
      plan_name: plan.display_name,
      subscribers,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_count: result.total_count,
        limit,
        has_next: page < totalPages,
        has_previous: page > 1,
      },
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error getting plan subscribers:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
