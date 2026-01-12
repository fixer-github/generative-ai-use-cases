/**
 * フロー実行履歴一覧取得API
 * GET /admin/billing/flow-executions
 *
 * フロー実行履歴一覧を取得します。検索・絞り込み・ページネーション機能をサポートします。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
} from '../../../utils/adminAuth';
import {
  ok200Response,
  badRequest400Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import { FlowExecutionRepository } from '../../orchestration/repositories/flowExecutionRepository';
import { FlowExecutionStatus, FlowType } from '../../orchestration/types';

interface QueryParams {
  limit?: string;
  next_token?: string;
  status?: string;
  flow_type?: string;
  user_id?: string;
  from_date?: string;
  to_date?: string;
}

interface FlowExecutionListItem {
  flow_execution_id: string;
  flow_type: FlowType;
  user_id: string | null;
  initiated_by: string;
  status: FlowExecutionStatus;
  started_at: string;
  completed_at: string | null;
  duration: number | null;
  current_step: string;
  total_steps: number | null;
  completed_steps: number | null;
  has_error: boolean;
}

interface ListFlowExecutionsResponse {
  flow_executions: FlowExecutionListItem[];
  pagination: {
    next_token: string | null;
    has_next: boolean;
  };
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

    const { tenantId } = adminResult;

    // クエリパラメータの取得
    const params = (event.queryStringParameters || {}) as QueryParams;

    // パラメータの検証とデフォルト値の設定
    const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10)));

    // statusのバリデーション
    const validStatuses: FlowExecutionStatus[] = ['in_progress', 'completed', 'failed', 'rolled_back'];
    if (params.status && !validStatuses.includes(params.status as FlowExecutionStatus)) {
      return badRequest400Response({
        message: '無効なパラメータが指定されました',
        code: 'INVALID_PARAMETER',
        details: {
          field: 'status',
          reason: `statusには '${validStatuses.join("', '")}' のいずれかを指定してください`,
        },
      });
    }

    // flow_typeのバリデーション
    const validFlowTypes: FlowType[] = ['purchase', 'plan_change', 'cancellation', 'webhook_event'];
    if (params.flow_type && !validFlowTypes.includes(params.flow_type as FlowType)) {
      return badRequest400Response({
        message: '無効なパラメータが指定されました',
        code: 'INVALID_PARAMETER',
        details: {
          field: 'flow_type',
          reason: `flow_typeには '${validFlowTypes.join("', '")}' のいずれかを指定してください`,
        },
      });
    }

    // 日付パラメータのバリデーション
    let fromDate: number | undefined;
    let toDate: number | undefined;

    if (params.from_date) {
      const parsedDate = Date.parse(params.from_date);
      if (isNaN(parsedDate)) {
        return badRequest400Response({
          message: '無効なパラメータが指定されました',
          code: 'INVALID_PARAMETER',
          details: {
            field: 'from_date',
            reason: 'from_dateはISO 8601形式で指定してください（例: 2025-01-01T00:00:00Z）',
          },
        });
      }
      fromDate = parsedDate;
    }

    if (params.to_date) {
      const parsedDate = Date.parse(params.to_date);
      if (isNaN(parsedDate)) {
        return badRequest400Response({
          message: '無効なパラメータが指定されました',
          code: 'INVALID_PARAMETER',
          details: {
            field: 'to_date',
            reason: 'to_dateはISO 8601形式で指定してください（例: 2025-01-01T23:59:59Z）',
          },
        });
      }
      toDate = parsedDate;
    }

    // next_tokenのデコード
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    if (params.next_token) {
      try {
        const decoded = Buffer.from(params.next_token, 'base64').toString('utf-8');
        lastEvaluatedKey = JSON.parse(decoded);
      } catch {
        return badRequest400Response({
          message: '無効なパラメータが指定されました',
          code: 'INVALID_PARAMETER',
          details: {
            field: 'next_token',
            reason: 'next_tokenが無効です',
          },
        });
      }
    }

    // リポジトリを使用してデータを取得
    const repository = new FlowExecutionRepository(tenantId);
    const result = await repository.listWithFilters({
      status: params.status as FlowExecutionStatus | undefined,
      flowType: params.flow_type as FlowType | undefined,
      userId: params.user_id,
      fromDate,
      toDate,
      limit,
      lastEvaluatedKey,
    });

    // レスポンスの構築
    const flowExecutions: FlowExecutionListItem[] = result.items.map(item => ({
      flow_execution_id: item.flowExecutionId,
      flow_type: item.flowType,
      user_id: item.userId || null,
      initiated_by: item.initiatedBy,
      status: item.status,
      started_at: new Date(item.startedAt).toISOString(),
      completed_at: item.completedAt ? new Date(item.completedAt).toISOString() : null,
      duration: item.duration || null,
      current_step: item.currentStep,
      total_steps: item.totalSteps || null,
      completed_steps: item.completedSteps || null,
      has_error: item.errorDetails !== undefined,
    }));

    // next_tokenのエンコード
    let nextToken: string | null = null;
    if (result.lastEvaluatedKey) {
      nextToken = Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64');
    }

    const response: ListFlowExecutionsResponse = {
      flow_executions: flowExecutions,
      pagination: {
        next_token: nextToken,
        has_next: result.lastEvaluatedKey !== undefined,
      },
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error listing flow executions:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
