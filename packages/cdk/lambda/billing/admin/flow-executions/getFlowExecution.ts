/**
 * フロー実行履歴詳細取得API
 * GET /admin/billing/flow-executions/{flowExecutionId}
 *
 * 指定されたフロー実行履歴の詳細とステップ実行履歴を取得します。
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyAdminAccess,
  isAdminContext,
} from '../../../utils/adminAuth';
import {
  ok200Response,
  badRequest400Response,
  notFound404Response,
  internalServerError500Response,
} from '../../../utils/apiResponse';
import { FlowExecutionRepository } from '../../orchestration/repositories/flowExecutionRepository';
import { FlowStepExecutionRepository } from '../../orchestration/repositories/flowStepExecutionRepository';
import { FlowExecution, StepExecution } from '../../orchestration/types';

interface FlowExecutionDetail {
  flow_execution_id: string;
  tenant_id: string;
  flow_type: string;
  user_id: string | null;
  initiated_by: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration: number | null;
  current_step: string;
  total_steps: number | null;
  completed_steps: number | null;
  input_parameters: Record<string, unknown>;
  output_result: Record<string, unknown> | null;
  error_details: {
    error_code?: string;
    error_message: string;
    stack_trace?: string;
  } | null;
}

interface StepExecutionDetail {
  step_sequence: number;
  step_name: string;
  step_type: string;
  target_service: string | null;
  target_function: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration: number | null;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error_details: {
    error_code?: string;
    error_message: string;
    stack_trace?: string;
  } | null;
  retry_count: number;
}

interface GetFlowExecutionResponse {
  flow_execution: FlowExecutionDetail;
  step_executions: StepExecutionDetail[];
}

const mapErrorDetails = (
  errorDetails?: { errorCode?: string; errorMessage: string; stackTrace?: string }
): { error_code?: string; error_message: string; stack_trace?: string } | null => {
  if (!errorDetails) return null;
  return {
    error_code: errorDetails.errorCode,
    error_message: errorDetails.errorMessage,
    stack_trace: errorDetails.stackTrace,
  };
};

const mapFlowExecution = (item: FlowExecution): FlowExecutionDetail => ({
  flow_execution_id: item.flowExecutionId,
  tenant_id: item.tenantId,
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
  input_parameters: item.inputParameters,
  output_result: item.outputResult || null,
  error_details: mapErrorDetails(item.errorDetails),
});

const mapStepExecution = (item: StepExecution): StepExecutionDetail => ({
  step_sequence: item.stepSequence,
  step_name: item.stepName,
  step_type: item.stepType,
  target_service: item.targetService || null,
  target_function: item.targetFunction || null,
  status: item.status,
  started_at: item.startedAt ? new Date(item.startedAt).toISOString() : null,
  completed_at: item.completedAt ? new Date(item.completedAt).toISOString() : null,
  duration: item.duration || null,
  input_data: item.inputData || null,
  output_data: item.outputData || null,
  error_details: mapErrorDetails(item.errorDetails),
  retry_count: item.retryCount || 0,
});

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

    // パスパラメータからflowExecutionIdを取得
    const flowExecutionId = event.pathParameters?.flowExecutionId;
    if (!flowExecutionId) {
      return badRequest400Response({
        message: '無効なパラメータが指定されました',
        code: 'INVALID_PARAMETER',
        details: {
          field: 'flowExecutionId',
          reason: 'flowExecutionIdは必須です',
        },
      });
    }

    // フロー実行履歴を取得
    const flowRepository = new FlowExecutionRepository(tenantId);
    const flowExecution = await flowRepository.getById(flowExecutionId);

    if (!flowExecution) {
      return notFound404Response({
        message: '指定されたフロー実行履歴が見つかりません',
        code: 'FLOW_EXECUTION_NOT_FOUND',
        details: {
          flow_execution_id: flowExecutionId,
        },
      });
    }

    // ステップ実行履歴を取得
    const stepRepository = new FlowStepExecutionRepository(tenantId);
    const stepExecutions = await stepRepository.listByFlowExecution(flowExecutionId);

    // レスポンスの構築
    const response: GetFlowExecutionResponse = {
      flow_execution: mapFlowExecution(flowExecution),
      step_executions: stepExecutions.map(mapStepExecution),
    };

    return ok200Response(response);
  } catch (error) {
    console.error('Error getting flow execution:', error);
    return internalServerError500Response({
      message: 'サーバー内部エラーが発生しました',
      code: 'INTERNAL_SERVER_ERROR',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
};
